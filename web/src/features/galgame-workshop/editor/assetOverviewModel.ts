import {
  Boxes,
  CircleDot,
  File,
  FileImage,
  FileText,
  Film,
  Grid2X2,
  Layers3,
  Music2,
  Sparkles,
  Type,
  Volume2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import type {
  GalgameAssetCategory,
  GalgameAssetOverview,
} from "@features/galgame-workshop/api";

export type AssetItem = GalgameAssetOverview["items"][number];
export type AssetDisplayKind =
  | "image"
  | "audio"
  | "video"
  | "font"
  | "document"
  | "particle"
  | "ui"
  | "transition"
  | "other";
export type AssetStatus =
  "all" | "referenced" | "orphaned" | "include" | "exclude";
export type AssetSelection =
  { kind: "asset"; id: string } | { kind: "missing"; id: string };

export const SUMMARY_HEIGHT_KEY = "future_props_galgame_asset_summary_height";
export const MIN_SUMMARY_HEIGHT = 180;
export const MIN_BROWSER_HEIGHT = 180;
export const SUMMARY_RESIZER_HEIGHT = 8;
export const ASSET_TOOLBAR_HEIGHT = 46;

export function loadSummaryHeight() {
  try {
    const stored = Number(localStorage.getItem(SUMMARY_HEIGHT_KEY));
    return Number.isFinite(stored) && stored >= MIN_SUMMARY_HEIGHT
      ? stored
      : null;
  } catch {
    return null;
  }
}

export interface DirectoryNode {
  name: string;
  path: string;
  count: number;
  children: DirectoryNode[];
}

export const CATEGORY_OPTIONS: Array<{
  value: GalgameAssetCategory;
  label: string;
}> = [
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "cg", label: "剧情 CG" },
  { value: "bgm", label: "BGM" },
  { value: "ambient", label: "环境音" },
  { value: "sfx", label: "音效" },
  { value: "voice", label: "语音" },
  { value: "video", label: "视频" },
  { value: "font", label: "字体" },
  { value: "other", label: "其他" },
];

export const KIND_META: Record<
  AssetDisplayKind,
  { label: string; icon: LucideIcon; className: string }
> = {
  image: { label: "图片", icon: FileImage, className: "is-image" },
  audio: { label: "音频", icon: Music2, className: "is-audio" },
  video: { label: "视频", icon: Film, className: "is-video" },
  font: { label: "字体", icon: Type, className: "is-font" },
  document: { label: "文档", icon: FileText, className: "is-document" },
  particle: { label: "粒子", icon: Sparkles, className: "is-particle" },
  ui: { label: "界面", icon: Grid2X2, className: "is-ui" },
  transition: {
    label: "过渡图",
    icon: Layers3,
    className: "is-transition",
  },
  other: { label: "其他", icon: File, className: "is-other" },
};

export const STATUS_OPTIONS: Array<{
  value: AssetStatus;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "all", label: "全部", icon: Grid2X2 },
  { value: "referenced", label: "已引用", icon: CircleDot },
  { value: "orphaned", label: "游离", icon: CircleDot },
  { value: "include", label: "强制打包", icon: CircleDot },
  { value: "exclude", label: "强制排除", icon: CircleDot },
];

export const MODULES: Array<{
  label: string;
  categories: GalgameAssetCategory[];
  icon: LucideIcon;
}> = [
  { label: "角色", categories: ["character"], icon: Boxes },
  { label: "场景", categories: ["scene"], icon: FileImage },
  { label: "CG", categories: ["cg"], icon: Layers3 },
  { label: "BGM", categories: ["bgm"], icon: Music2 },
  { label: "音效", categories: ["ambient", "sfx"], icon: Volume2 },
  { label: "语音", categories: ["voice"], icon: WandSparkles },
  { label: "视频", categories: ["video"], icon: Film },
];

export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function duration(value?: number | null) {
  if (!value) return "—";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function cleanPath(value?: string | null) {
  return (value ?? "")
    .replace(/^\/+/, "")
    .replace(/^assets\//i, "")
    .replace(/\/{2,}/g, "/");
}

export function displayKind(item: AssetItem): AssetDisplayKind {
  const root = cleanPath(item.virtualPath).split("/")[0]?.toLowerCase();
  if (root === "particles") return "particle";
  if (root === "ui") return "ui";
  if (root === "transitions") return "transition";
  if (item.media_kind === "image") return "image";
  if (item.media_kind === "audio") return "audio";
  if (item.media_kind === "video") return "video";
  if (item.media_kind === "font") return "font";
  if (item.media_kind === "document") return "document";
  return "other";
}

export function directoryTree(items: AssetItem[]): DirectoryNode {
  const root: DirectoryNode = {
    name: "assets",
    path: "",
    count: items.length,
    children: [],
  };
  for (const item of items) {
    const parts = cleanPath(item.virtualPath).split("/").filter(Boolean);
    parts.pop();
    let parent = root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = parent.children.find((candidate) => candidate.name === part);
      if (!node) {
        node = { name: part, path, count: 0, children: [] };
        parent.children.push(node);
      }
      node.count += 1;
      parent = node;
    }
  }
  const sort = (node: DirectoryNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function matchesStatus(item: AssetItem, status: AssetStatus) {
  if (status === "referenced") return item.reference_count > 0;
  if (status === "orphaned") return item.orphaned;
  if (status === "include") return item.packagingPolicy === "include";
  if (status === "exclude") return item.packagingPolicy === "exclude";
  return true;
}

export function assetError(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "素材已在其他操作中更新，已重新载入最新数据。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
