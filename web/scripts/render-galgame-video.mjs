import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const [, , manifestFile, outputFile] = process.argv;
if (!manifestFile || !outputFile)
  throw new Error("usage: render <manifest> <output>");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const presets = {
  "1080p30": { width: 1920, height: 1080, fps: 30 },
  "720p30": { width: 1280, height: 720, fps: 30 },
  "1080p60": { width: 1920, height: 1080, fps: 60 },
};
const preset = presets[manifest.preset] ?? presets["1080p30"];
const videoDir = join(dirname(outputFile), "browser-video");

function fragmentExportDocument(document, fragmentIds) {
  if (!fragmentIds?.length) return document;
  const fragments = new Map(
    (document.chapters ?? []).flatMap((chapter) =>
      (chapter.fragments ?? []).map((fragment) => [fragment.id, fragment]),
    ),
  );
  const chapters = fragmentIds.map((fragmentId, index) => {
    const source = fragments.get(fragmentId);
    if (!source) throw new Error(`所选 Fragment 已不存在：${fragmentId}`);
    const blocks = (source.blocks ?? []).filter(
      (block) =>
        ![
          "branch",
          "if",
          "callFragment",
          "endChapter",
          "returnToEntry",
        ].includes(block.type),
    );
    blocks.push({
      id: `export-end-${index + 1}`,
      type: "endChapter",
      label: index + 1 === fragmentIds.length ? source.title : "",
    });
    return {
      id: `export-chapter-${index + 1}`,
      title: source.title,
      order: index + 1,
      entryFragmentId: source.id,
      disabled: false,
      fragments: [{ ...source, blocks }],
    };
  });
  return { ...document, entryChapterId: chapters[0].id, chapters };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(stderr || `${command} exited ${code}`)),
    );
  });
}

function audioPlan(events, totalMs) {
  const plays = [];
  const active = new Map();
  for (const event of [...events].sort((a, b) => a.atMs - b.atMs)) {
    if (event.action === "play" && event.storyAssetId) {
      if (event.channel !== "sfx") {
        const previous = active.get(event.channel);
        if (previous) {
          previous.endMs = Math.min(previous.endMs, event.atMs);
          previous.stopFadeMs = event.fadeMs;
        }
        active.set(event.channel, event);
      }
      event.endMs = totalMs;
      plays.push(event);
      continue;
    }
    if (event.action === "stop") {
      if (event.channel === "sfx") {
        for (const playing of plays)
          if (playing.channel === "sfx" && playing.endMs === totalMs) {
            playing.endMs = Math.min(playing.endMs, event.atMs);
            playing.stopFadeMs = event.fadeMs;
          }
      } else {
        const playing = active.get(event.channel);
        if (playing) {
          playing.endMs = Math.min(playing.endMs, event.atMs);
          playing.stopFadeMs = event.fadeMs;
        }
        active.delete(event.channel);
      }
    }
  }
  return plays.filter((event) => event.endMs > event.atMs);
}

function cropAudioPlan(events, startMs, endMs) {
  return events.flatMap((event) => {
    const overlapStartMs = Math.max(startMs, event.atMs);
    const overlapEndMs = Math.min(endMs, event.endMs);
    if (overlapEndMs <= overlapStartMs) return [];
    return [
      {
        ...event,
        atMs: overlapStartMs - startMs,
        endMs: overlapEndMs - startMs,
        offsetMs:
          Math.max(0, Number(event.offsetMs ?? 0)) +
          (overlapStartMs - event.atMs),
      },
    ];
  });
}
let browser;
let context;
let page;
let rawVideo;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  context = await browser.newContext({
    viewport: { width: preset.width, height: preset.height },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: videoDir,
      size: { width: preset.width, height: preset.height },
    },
  });
  page = await context.newPage();
  await page.route("**/v1/files/*/content", async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /\/v1\/files\/([^/]+)\/content$/,
    );
    const path = match
      ? manifest.assetPaths[decodeURIComponent(match[1])]
      : undefined;
    if (!path) return route.abort("failed");
    return route.fulfill({ path });
  });
  const clipRange = manifest.clipRange;
  const clipPreRollMs = clipRange ? Math.min(500, clipRange.startMs) : 0;
  const captureStartMs = clipRange
    ? Math.max(0, clipRange.startMs - clipPreRollMs)
    : 0;
  const selectedFragmentIds = clipRange
    ? [clipRange.fragmentId]
    : manifest.fragmentIds;
  await page.addInitScript(
    (value) => {
      window.__FPL_GALGAME_EXPORT__ = value;
    },
    {
      document: fragmentExportDocument(manifest.document, selectedFragmentIds),
      locale: manifest.locale,
      branchSelections: manifest.branchSelections,
      choiceDurationMs: manifest.choiceDurationMs,
      choiceHighlightMs: manifest.choiceHighlightMs,
      clipRange: clipRange ? { ...clipRange, captureStartMs } : undefined,
    },
  );
  await page.goto(manifest.rendererUrl, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__FPL_EXPORT_STATE__?.ready,
    undefined,
    {
      timeout: 60_000,
    },
  );
  const started = Date.now();
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  let complete = false;
  let result;
  const playbackMs = Number(manifest.totalMs || 0) + clipPreRollMs;
  const timeoutMs = Math.max(120_000, playbackMs + 300_000);
  while (!complete) {
    if (Date.now() - started > timeoutMs)
      throw new Error("Galgame 导出播放超时");
    await new Promise((resolve) => setTimeout(resolve, clipRange ? 50 : 1000));
    result = await page.evaluate(() => window.__FPL_EXPORT_STATE__);
    complete = Boolean(result?.complete);
    const renderedMs = Math.max(
      0,
      Math.min(
        Number(manifest.totalMs || Date.now() - started),
        Date.now() - started - clipPreRollMs,
      ),
    );
    if (complete || Date.now() - lastProgressAt >= 500) {
      lastProgressAt = Date.now();
      process.stdout.write(
        `${JSON.stringify({ phase: "rendering", renderedMs })}\n`,
      );
    }
  }
  if (!result?.ok) throw new Error(result?.label || "Galgame 播放失败");
  const video = page.video();
  await page.close();
  await context.close();
  context = undefined;
  rawVideo = await video.path();
  await browser.close();
  browser = undefined;

  const masterAsset = manifest.document.assets?.find(
    (asset) => asset.type === "audio" && asset.role === "timelineMaster",
  );
  const masterPath = masterAsset
    ? manifest.assetPaths[masterAsset.fileId]
    : undefined;
  const storyAssets = new Map(
    (manifest.document.assets ?? []).map((asset) => [asset.id, asset]),
  );
  const storyFragments = new Map(
    (manifest.document.chapters ?? []).flatMap((chapter) =>
      (chapter.fragments ?? []).map((fragment) => [fragment.id, fragment]),
    ),
  );
  const clipFragment = clipRange
    ? storyFragments.get(clipRange.fragmentId)
    : undefined;
  const clipMasterConfig = clipFragment?.timeline?.masterAudio;
  const clipMasterAsset = clipMasterConfig
    ? storyAssets.get(clipMasterConfig.assetId)
    : undefined;
  const clipMasterPath = clipMasterAsset
    ? manifest.assetPaths[clipMasterAsset.fileId]
    : undefined;
  let selectedOffsetMs = 0;
  const selectedMasterPlays = (manifest.fragmentIds ?? []).flatMap(
    (fragmentId, index) => {
      const fragment = storyFragments.get(fragmentId);
      const durationMs = Number(
        manifest.fragmentDurationsMs?.[index] ??
          fragment?.timeline?.durationMs ??
          0,
      );
      const config = fragment?.timeline?.masterAudio;
      const atMs = selectedOffsetMs;
      selectedOffsetMs += durationMs;
      return config
        ? [
            {
              action: "play",
              channel: "voice",
              storyAssetId: config.assetId,
              atMs,
              endMs: atMs + durationMs,
              volume: Math.max(0, Number(config.volume ?? 100)) / 100,
            },
          ]
        : [];
    },
  );
  const seconds = Math.max(0.001, Number(manifest.totalMs || 1) / 1000).toFixed(
    3,
  );
  const rawProbe = JSON.parse(
    await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      rawVideo,
    ]),
  );
  const rawDuration = Number(rawProbe.format?.duration || 0);
  const captureSeconds = Math.max(0.001, playbackMs / 1000);
  const trimStart = Math.max(0, rawDuration - captureSeconds - 0.05);
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    trimStart.toFixed(3),
    "-i",
    rawVideo,
  ];
  let audioFilter = "";
  if (clipMasterPath && clipRange) {
    ffmpegArgs.push(
      "-ss",
      (clipRange.startMs / 1000).toFixed(3),
      "-i",
      clipMasterPath,
    );
    const masterVolume = Number(clipMasterConfig?.volume ?? 100);
    audioFilter = `[1:a]volume=${Math.max(0, masterVolume) / 100},apad=whole_dur=${seconds},atrim=duration=${seconds},asetpts=PTS-STARTPTS[aout]`;
  } else if (masterPath && !manifest.fragmentIds?.length && !clipRange) {
    ffmpegArgs.push("-i", masterPath);
    const masterVolume = Number(
      manifest.document.chapters
        ?.flatMap((chapter) => chapter.fragments ?? [])
        .find((fragment) => fragment.timeline?.masterAudio)?.timeline
        ?.masterAudio?.volume ?? 100,
    );
    audioFilter = `[1:a]volume=${Math.max(0, masterVolume) / 100},apad=whole_dur=${seconds},atrim=duration=${seconds},asetpts=PTS-STARTPTS[aout]`;
  } else {
    const rawPlays = [
      ...audioPlan(result.audioEvents ?? [], playbackMs),
      ...selectedMasterPlays,
    ];
    const plays = clipRange
      ? cropAudioPlan(rawPlays, clipPreRollMs, playbackMs)
      : rawPlays;
    const filters = [];
    const labels = [];
    for (const event of plays) {
      const asset = storyAssets.get(event.storyAssetId);
      const path = asset ? manifest.assetPaths[asset.fileId] : undefined;
      if (!path) continue;
      if (event.loop) ffmpegArgs.push("-stream_loop", "-1");
      if (event.offsetMs)
        ffmpegArgs.push("-ss", (event.offsetMs / 1000).toFixed(3));
      ffmpegArgs.push("-i", path);
      const inputIndex =
        ffmpegArgs.filter((value) => value === "-i").length - 1;
      const duration = Math.max(0.001, (event.endMs - event.atMs) / 1000);
      const fadeIn = Math.min(
        duration,
        Math.max(0, Number(event.fadeMs || 0)) / 1000,
      );
      const fadeOut = Math.min(
        duration,
        Math.max(0, Number(event.stopFadeMs || 0)) / 1000,
      );
      const label = `a${labels.length}`;
      let filter = `[${inputIndex}:a]atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${Math.max(0, Number(event.volume ?? 1))}`;
      if (fadeIn > 0) filter += `,afade=t=in:st=0:d=${fadeIn.toFixed(3)}`;
      if (fadeOut > 0)
        filter += `,afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`;
      filter += `,adelay=${Math.max(0, Math.round(event.atMs))}:all=1[${label}]`;
      filters.push(filter);
      labels.push(`[${label}]`);
    }
    if (labels.length) {
      audioFilter = `${filters.join(";")};${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,apad=whole_dur=${seconds},atrim=duration=${seconds},asetpts=PTS-STARTPTS[aout]`;
    } else {
      ffmpegArgs.push(
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
      const silenceIndex =
        ffmpegArgs.filter((value) => value === "-i").length - 1;
      audioFilter = `[${silenceIndex}:a]atrim=duration=${seconds},asetpts=PTS-STARTPTS[aout]`;
    }
  }
  const videoFilter = `${
    clipPreRollMs > 0
      ? `trim=start=${(clipPreRollMs / 1000).toFixed(3)},setpts=PTS-STARTPTS,`
      : ""
  }fps=${preset.fps},scale=${preset.width}:${preset.height}:flags=lanczos`;
  ffmpegArgs.push(
    "-filter_complex",
    audioFilter,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-t",
    seconds,
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    outputFile,
  );
  process.stdout.write(
    `${JSON.stringify({ phase: "encoding", renderedMs: manifest.totalMs })}\n`,
  );
  await run("ffmpeg", ffmpegArgs);
} finally {
  await page?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
