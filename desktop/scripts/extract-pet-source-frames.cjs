// Diagnostic extraction: select existing encoded frames, never synthesize FPS.
const { spawnSync } = require("node:child_process");
const {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

function selectSourceFrames(
  pts,
  { start = 0, end = Infinity, cadenceMs } = {},
) {
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !(end >= start) ||
    (cadenceMs !== undefined && (!Number.isFinite(cadenceMs) || cadenceMs <= 0))
  )
    throw new Error("Invalid source range/cadence");
  if (pts.some((p, i) => !Number.isFinite(p) || (i && p <= pts[i - 1])))
    throw new Error("Source PTS must be finite and strictly increasing");
  const indices = pts.flatMap((p, i) => (p >= start && p <= end ? [i] : []));
  if (cadenceMs === undefined || indices.length < 2) return indices;
  const selected = [indices[0]],
    interval = cadenceMs / 1000;
  let position = 0;
  while (position < indices.length - 1) {
    let next = position;
    while (
      next + 1 < indices.length &&
      pts[indices[next + 1]] - pts[indices[position]] <= interval + 1e-9
    )
      next++;
    if (next === position)
      throw new Error("Source gap exceeds cadence; cannot fill dropped frames");
    selected.push(indices[next]);
    position = next;
  }
  return selected;
}

function sourceFilter(indices) {
  const ranges = [];
  for (const i of indices) {
    const last = ranges.at(-1);
    if (last && i === last[1] + 1) last[1] = i;
    else ranges.push([i, i]);
  }
  return `select=${ranges
    .map(([a, b]) => (a === b ? `eq(n\\,${a})` : `between(n\\,${a}\\,${b})`))
    .join("+")}`;
}

// FFmpeg's expression parser has a bounded stack. Keep each select expression
// small, while retaining absolute source indices and global output numbering.
function sourceBatches(indices, maxTerms = 48) {
  if (!Number.isSafeInteger(maxTerms) || maxTerms < 1 || maxTerms > 48)
    throw new Error("Invalid source batch limit");
  if (
    indices.some(
      (n, i) => !Number.isSafeInteger(n) || n < 0 || (i && n <= indices[i - 1]),
    )
  )
    throw new Error("Source indices must be strictly increasing integers");
  const batches = [];
  let batch = [],
    terms = 0,
    firstOutput = 1;
  for (const index of indices) {
    const newTerm = !batch.length || index !== batch.at(-1) + 1;
    if (newTerm && terms === maxTerms) {
      batches.push({
        indices: batch,
        filter: sourceFilter(batch),
        firstOutput,
      });
      firstOutput += batch.length;
      batch = [];
      terms = 0;
    }
    if (!batch.length || index !== batch.at(-1) + 1) terms++;
    batch.push(index);
  }
  if (batch.length)
    batches.push({ indices: batch, filter: sourceFilter(batch), firstOutput });
  return batches;
}

function command(name, args) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}`);
  return result.stdout;
}

function main(args) {
  const [input, output, ...flags] = args;
  if (!input || !output || flags.length % 2)
    throw new Error(
      "Usage: node extract-pet-source-frames.cjs input.webm ignored-output [--start seconds] [--end seconds] [--cadence-ms ms]",
    );
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const key = {
      "--start": "start",
      "--end": "end",
      "--cadence-ms": "cadenceMs",
    }[flags[i]];
    if (!key || key in options) throw new Error(`Invalid option ${flags[i]}`);
    const value = Number(flags[i + 1]);
    if (!Number.isFinite(value)) throw new Error(`Invalid value ${flags[i]}`);
    options[key] = value;
  }
  const root = path.resolve(__dirname, "../.."),
    destination = path.resolve(output),
    localRoot = path.join(root, ".local");
  if (!destination.startsWith(`${localRoot}${path.sep}`))
    throw new Error("Source frame products must be under root .local/");
  let ancestor = path.dirname(destination);
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actualAncestor = realpathSync(ancestor),
    actualLocal = realpathSync(localRoot);
  if (
    actualAncestor !== actualLocal &&
    !actualAncestor.startsWith(`${actualLocal}${path.sep}`)
  )
    throw new Error(
      "Source frame output cannot follow a symlink outside .local/",
    );
  command("git", ["-C", root, "check-ignore", destination]);
  if (existsSync(destination))
    throw new Error(
      "Choose a new ignored output directory; existing evidence is preserved",
    );
  const source = path.resolve(input),
    probe = JSON.parse(
      command("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "json",
        source,
      ]),
    ),
    pts = probe.frames.map((frame) => Number(frame.best_effort_timestamp_time)),
    indices = selectSourceFrames(pts, options),
    batches = sourceBatches(indices);
  if (!indices.length) throw new Error("No source frames in requested range");
  mkdirSync(destination, { recursive: true });
  writeFileSync(
    path.join(destination, "source-manifest.json"),
    JSON.stringify(
      {
        source,
        sourceSha256: createHash("sha256")
          .update(readFileSync(source))
          .digest("hex"),
        options,
        frames: indices.map((sourceIndex, i) => ({
          file: `source-${String(i + 1).padStart(5, "0")}.png`,
          sourceIndex,
          pts: pts[sourceIndex],
        })),
        filter: batches.length === 1 ? batches[0].filter : null,
        filters: batches,
        noFpsFill: true,
      },
      null,
      2,
    ),
  );
  for (const batch of batches)
    command("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-n",
      "-i",
      source,
      "-vf",
      batch.filter,
      "-fps_mode",
      "passthrough",
      "-start_number",
      String(batch.firstOutput),
      "-frames:v",
      String(batch.indices.length),
      path.join(destination, "source-%05d.png"),
    ]);
  console.log(
    `Extracted ${indices.length} original source frames to ${destination}`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { selectSourceFrames, sourceFilter, sourceBatches };
