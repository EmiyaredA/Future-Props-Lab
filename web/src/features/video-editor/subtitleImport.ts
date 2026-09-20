import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTrack,
} from "./types";
import { defaultTextStyle } from "./textModel";

export type SubtitleFormat = "srt" | "vtt" | "ass";
export type SubtitleTimingMode = "original" | "playhead";

export type SubtitleCue = {
  startUs: number;
  endUs: number;
  text: string;
  line: number;
};

export type SubtitleWarning = {
  line: number;
  message: string;
};

export type SubtitleParseResult = {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  warnings: SubtitleWarning[];
  skippedCount: number;
};

function extensionFor(filename: string): SubtitleFormat | undefined {
  const extension = filename.toLowerCase().split(".").at(-1);
  return extension === "srt" || extension === "vtt" || extension === "ass"
    ? extension
    : undefined;
}

function detectFormat(filename: string, source: string): SubtitleFormat {
  const byExtension = extensionFor(filename);
  if (byExtension) return byExtension;
  if (/^\uFEFF?WEBVTT(?:\s|$)/i.test(source.trim())) return "vtt";
  if (/^\s*\[(?:script info|events)\]/im.test(source)) return "ass";
  return "srt";
}

function parseTime(value: string, format: SubtitleFormat): number | undefined {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const [wholeSeconds, fraction = ""] = parts.at(-1)!.split(".");
  const seconds = Number(wholeSeconds);
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return undefined;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60)
    return undefined;
  if (format === "ass" && !/^\d{1,2}:\d{2}:\d{2}\.\d{2}$/.test(normalized))
    return undefined;
  const milliseconds =
    format === "ass"
      ? Number(fraction.padEnd(2, "0").slice(0, 2)) * 10
      : Number(fraction.padEnd(3, "0").slice(0, 3));
  return Math.round(
    (hours * 3600 + minutes * 60 + seconds) * 1_000_000 + milliseconds * 1000,
  );
}

function parseTimingLine(
  line: string,
  format: SubtitleFormat,
): { startUs: number; endUs: number } | undefined {
  const [start, end] = line.split("-->", 2);
  if (!start || !end) return undefined;
  const endValue = end.trim().split(/\s+/, 1)[0];
  const startUs = parseTime(start, format);
  const endUs = parseTime(endValue, format);
  return startUs === undefined || endUs === undefined
    ? undefined
    : { startUs, endUs };
}

function cleanText(value: string) {
  return value
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/\\r/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function warning(line: number, message: string): SubtitleWarning {
  return { line, message };
}

function addCue(
  cues: SubtitleCue[],
  warnings: SubtitleWarning[],
  startUs: number | undefined,
  endUs: number | undefined,
  text: string,
  line: number,
) {
  const cleaned = cleanText(text);
  if (startUs === undefined || endUs === undefined) {
    warnings.push(warning(line, "时间码无法识别，已跳过"));
    return;
  }
  if (endUs <= startUs) {
    warnings.push(warning(line, "结束时间必须晚于开始时间，已跳过"));
    return;
  }
  if (!cleaned) {
    warnings.push(warning(line, "字幕文本为空，已跳过"));
    return;
  }
  if (cleaned.length > 4000) {
    warnings.push(warning(line, "字幕文本超过 4000 个字符，已跳过"));
    return;
  }
  cues.push({ startUs, endUs, text: cleaned, line });
}

function parseSrt(source: string, format: SubtitleFormat) {
  const lines = source.split("\n");
  const cues: SubtitleCue[] = [];
  const warnings: SubtitleWarning[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index]!.trim()) index += 1;
    if (index >= lines.length) break;
    const blockLine = index + 1;
    if (/^\d+$/.test(lines[index]!.trim())) index += 1;
    const timingLine = lines[index];
    if (!timingLine?.includes("-->")) {
      warnings.push(warning(blockLine, "找不到字幕时间码，已跳过此段"));
      while (index < lines.length && lines[index]!.trim()) index += 1;
      continue;
    }
    const timing = parseTimingLine(timingLine, format);
    const timingLineNumber = index + 1;
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]!.trim()) {
      textLines.push(lines[index]!);
      index += 1;
    }
    addCue(
      cues,
      warnings,
      timing?.startUs,
      timing?.endUs,
      textLines.join("\n"),
      timingLineNumber,
    );
  }
  return { cues, warnings };
}

function parseVtt(source: string) {
  const lines = source.split("\n");
  const cues: SubtitleCue[] = [];
  const warnings: SubtitleWarning[] = [];
  let index = 0;
  if (/^\uFEFF?WEBVTT/i.test(lines[0] ?? "")) index = 1;
  while (index < lines.length) {
    while (index < lines.length && !lines[index]!.trim()) index += 1;
    if (index >= lines.length) break;
    const marker = lines[index]!.trim().toUpperCase();
    if (
      ["NOTE", "STYLE", "REGION"].some(
        (kind) => marker === kind || marker.startsWith(kind + " "),
      )
    ) {
      index += 1;
      while (index < lines.length && lines[index]!.trim()) index += 1;
      continue;
    }
    if (!lines[index]!.includes("-->")) index += 1;
    const timingLine = lines[index];
    if (!timingLine?.includes("-->")) {
      warnings.push(warning(index + 1, "找不到字幕时间码，已跳过此段"));
      while (index < lines.length && lines[index]!.trim()) index += 1;
      continue;
    }
    const timing = parseTimingLine(timingLine, "vtt");
    const timingLineNumber = index + 1;
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]!.trim()) {
      textLines.push(lines[index]!);
      index += 1;
    }
    addCue(
      cues,
      warnings,
      timing?.startUs,
      timing?.endUs,
      textLines.join("\n"),
      timingLineNumber,
    );
  }
  return { cues, warnings };
}

function parseAss(source: string) {
  const lines = source.split("\n");
  const cues: SubtitleCue[] = [];
  const warnings: SubtitleWarning[] = [];
  let inEvents = false;
  let fields = [
    "layer",
    "start",
    "end",
    "style",
    "name",
    "marginl",
    "marginr",
    "marginv",
    "effect",
    "text",
  ];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (/^\[events\]$/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\[.+\]$/.test(line)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      fields = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const values = line.slice(line.indexOf(":") + 1).split(",");
    if (values.length < fields.length) {
      warnings.push(warning(index + 1, "ASS Dialogue 字段数量不足，已跳过"));
      continue;
    }
    const valueFor = (field: string) => values[fields.indexOf(field)]?.trim();
    const start = parseTime(valueFor("start") ?? "", "ass");
    const end = parseTime(valueFor("end") ?? "", "ass");
    const textIndex = fields.indexOf("text");
    if (textIndex < 0) {
      warnings.push(warning(index + 1, "ASS Format 中缺少 Text 字段，已跳过"));
      continue;
    }
    const text = values.slice(textIndex).join(",");
    addCue(cues, warnings, start, end, text, index + 1);
  }
  return { cues, warnings };
}

function removeOverlaps(cues: SubtitleCue[], warnings: SubtitleWarning[]) {
  const sorted = [...cues].sort(
    (left, right) => left.startUs - right.startUs || left.line - right.line,
  );
  const accepted: SubtitleCue[] = [];
  for (const cue of sorted) {
    const previous = accepted.at(-1);
    if (previous && cue.startUs < previous.endUs) {
      warnings.push(warning(cue.line, "字幕时间段与上一条重叠，已跳过"));
      continue;
    }
    accepted.push(cue);
  }
  return accepted;
}

export function parseSubtitleText(
  filename: string,
  input: string,
): SubtitleParseResult {
  const source = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const format = detectFormat(filename, source);
  const parsed =
    format === "vtt"
      ? parseVtt(source)
      : format === "ass"
        ? parseAss(source)
        : parseSrt(source, "srt");
  const cues = removeOverlaps(parsed.cues, parsed.warnings);
  return {
    format,
    cues,
    warnings: parsed.warnings,
    skippedCount: parsed.warnings.filter((item) =>
      item.message.includes("已跳过"),
    ).length,
  };
}

export async function parseSubtitleFile(file: File) {
  const format = extensionFor(file.name);
  if (!format) throw new Error("请选择 .srt、.vtt 或 .ass 字幕文件");
  const result = parseSubtitleText(file.name, await file.text());
  if (!result.cues.length && !result.warnings.length)
    throw new Error("文件中没有可导入的字幕");
  return result;
}

function subtitleClip(
  cue: SubtitleCue,
  trackId: string,
  startUs: number,
): VideoEditorClip {
  return {
    id: crypto.randomUUID(),
    trackId,
    kind: "text",
    name: `字幕 ${String(cue.line).padStart(3, "0")}`,
    timelineStartUs: startUs,
    durationUs: cue.endUs - cue.startUs,
    sourceInUs: 0,
    playbackRate: 1,
    sourceLoop: false,
    text: cue.text,
    fontSize: 48,
    textColor: "#ffffff",
    textMaxWidth: 1600,
    textStyle: { ...defaultTextStyle, strokeWidth: 2 },
    fitMode: "native",
    flipX: false,
    volume: 1,
    muted: false,
    transform: {
      x: 960,
      y: 1000,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      anchor: "bottomCenter",
      brightness: 1,
    },
    keyframes: [],
  };
}

export function subtitleImportOperations(
  cues: SubtitleCue[],
  tracks: VideoEditorTrack[],
  playheadUs: number,
  mode: SubtitleTimingMode,
) {
  if (!cues.length) throw new Error("没有可导入的字幕");
  const ordered = [...tracks].sort((left, right) => left.order - right.order);
  const trackId = crypto.randomUUID();
  const offset = mode === "playhead" ? playheadUs - cues[0]!.startUs : 0;
  const track: VideoEditorTrack = {
    id: trackId,
    name: "字幕",
    kind: "visual",
    order: 0,
    locked: false,
    hidden: false,
    muted: false,
    clips: cues.map((cue) => subtitleClip(cue, trackId, cue.startUs + offset)),
  };
  const redo: VideoEditorOperation[] = ordered.map((item) => ({
    type: "reorderTrack",
    trackId: item.id,
    order: item.order + 1,
  }));
  redo.push({ type: "addTrack", track });
  const undo: VideoEditorOperation[] = [
    { type: "removeTrack", trackId },
    ...ordered.map((item) => ({
      type: "reorderTrack" as const,
      trackId: item.id,
      order: item.order,
    })),
  ];
  return { track, redo, undo, offset };
}
