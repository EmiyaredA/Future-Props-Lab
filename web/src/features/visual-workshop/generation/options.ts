import type { CSSProperties } from "react";
import type { SelectOption } from "@shared/ui/CustomSelect";

export type GenerationKind = "image" | "video";
export type VideoMode = "text" | "image" | "frames" | "reference";

export const MEDIA_ACCEPT: Record<"image" | "video" | "audio", string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/mp4,audio/ogg",
};

export const VIDEO_RATIO_OPTIONS: SelectOption[] = [
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:1",
].map((value) => ({ value, label: value }));
export const VIDEO_RESOLUTION_OPTIONS: SelectOption[] = [
  "480p",
  "720p",
  "1080p",
].map((value) => ({ value, label: value.toUpperCase() }));
export const IMAGE_RATIO_OPTIONS = [
  { label: "1:1", width: 1, height: 1 },
  { label: "2:3", width: 2, height: 3 },
  { label: "3:2", width: 3, height: 2 },
  { label: "3:4", width: 3, height: 4 },
  { label: "4:3", width: 4, height: 3 },
  { label: "4:5", width: 4, height: 5 },
  { label: "5:4", width: 5, height: 4 },
  { label: "9:16", width: 9, height: 16 },
  { label: "16:9", width: 16, height: 9 },
  { label: "21:9", width: 21, height: 9 },
] as const;
export const IMAGE_CLARITY_OPTIONS = ["1K", "2K", "4K"] as const;

type ImageRatio = (typeof IMAGE_RATIO_OPTIONS)[number]["label"];
type ImageClarity = (typeof IMAGE_CLARITY_OPTIONS)[number];
export type ImageSizeChoice = {
  value: string;
  width: number;
  height: number;
  ratio: ImageRatio;
  clarity: ImageClarity;
};

function classifyImageRatio(width: number, height: number): ImageRatio {
  const ratio = width / height;
  return IMAGE_RATIO_OPTIONS.reduce((nearest, option) =>
    Math.abs(Math.log(ratio / (option.width / option.height))) <
    Math.abs(Math.log(ratio / (nearest.width / nearest.height)))
      ? option
      : nearest,
  ).label;
}

function classifyImageClarity(width: number, height: number): ImageClarity {
  const longEdge = Math.max(width, height);
  if (longEdge < 2048) return "1K";
  if (longEdge < 3328) return "2K";
  return "4K";
}

export function imageSizeChoices(sizes: string[]): ImageSizeChoice[] {
  return sizes.flatMap((value) => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return [];
    const width = Number(match[1]);
    const height = Number(match[2]);
    return [
      {
        value,
        width,
        height,
        ratio: classifyImageRatio(width, height),
        clarity: classifyImageClarity(width, height),
      },
    ];
  });
}

export function imageRatioIconStyle(
  option: (typeof IMAGE_RATIO_OPTIONS)[number],
): CSSProperties {
  const ratio = option.width / option.height;
  return ratio >= 1
    ? { width: 32, height: Math.max(12, 32 / ratio) }
    : { width: Math.max(12, 32 * ratio), height: 32 };
}
