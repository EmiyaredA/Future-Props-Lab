import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { richTextSummary } from "@features/galgame-workshop/editor/richText";

export type BlockCategory = "text" | "character" | "stage" | "logic";
export type BlockTiming = "flow" | "point" | "duration" | "terminal";

export type BlockCapability = {
  label: string;
  category: BlockCategory;
  timing: BlockTiming;
  renpyKeyword: string;
  defaults: () => Record<string, unknown>;
  summary: (block: GalgameStoryBlock, document: GalgameStoryProject) => string;
  assetIds: (block: GalgameStoryBlock) => string[];
};

const text =
  (field = "text") =>
  (block: GalgameStoryBlock) => {
    if (
      "content" in block &&
      block.content &&
      typeof block.content === "object"
    )
      return richTextSummary(block.content);
    const value = (block as unknown as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim() ? value.trim() : "未填写";
  };
const fixed = (value: string) => () => value;
const asset =
  (field = "assetId") =>
  (block: GalgameStoryBlock) => {
    const value = (block as unknown as Record<string, unknown>)[field];
    return typeof value === "string" ? [value] : [];
  };
const noAssets = () => [];

export const BLOCK_REGISTRY = {
  narration: {
    label: "旁白",
    category: "text",
    timing: "duration",
    renpyKeyword: "narrate",
    defaults: () => ({ text: "", hideDialogueAfter: false }),
    summary: text(),
    assetIds: noAssets,
  },
  dialogue: {
    label: "对话",
    category: "character",
    timing: "duration",
    renpyKeyword: "say",
    defaults: () => ({ text: "", voiceVolume: 100, hideDialogueAfter: false }),
    summary: text(),
    assetIds: asset("voiceAssetId"),
  },
  storyParagraph: {
    label: "段落",
    category: "text",
    timing: "duration",
    renpyKeyword: "paragraph",
    defaults: () => ({ text: "", textSpeedCps: 0 }),
    summary: text(),
    assetIds: noAssets,
  },
  paragraphParams: {
    label: "段落参数",
    category: "text",
    timing: "flow",
    renpyKeyword: "paragraph_params",
    defaults: () => ({ textSpeedCps: 0 }),
    summary: fixed("调整后续段落呈现"),
    assetIds: noAssets,
  },
  systemMessage: {
    label: "系统消息",
    category: "text",
    timing: "duration",
    renpyKeyword: "system",
    defaults: () => ({ text: "", mode: "alert", tone: "info" }),
    summary: text(),
    assetIds: noAssets,
  },
  comment: {
    label: "注释",
    category: "text",
    timing: "flow",
    renpyKeyword: "#",
    defaults: () => ({ text: "" }),
    summary: text(),
    assetIds: noAssets,
  },
  wait: {
    label: "等待",
    category: "text",
    timing: "duration",
    renpyKeyword: "pause",
    defaults: () => ({ mode: "duration", durationMs: 1000 }),
    summary: fixed("等待一段时间"),
    assetIds: noAssets,
  },
  scene: {
    label: "场景",
    category: "stage",
    timing: "point",
    renpyKeyword: "scene",
    defaults: () => ({ clearCharacters: true }),
    summary: fixed("切换场景"),
    assetIds: noAssets,
  },
  destroyScene: {
    label: "销毁场景",
    category: "stage",
    timing: "point",
    renpyKeyword: "studio destroyScene",
    defaults: () => ({ durationMs: 400, waitForCompletion: false }),
    summary: fixed("清空舞台场景"),
    assetIds: noAssets,
  },
  showCharacter: {
    label: "角色登场",
    category: "character",
    timing: "point",
    renpyKeyword: "show",
    defaults: () => ({}),
    summary: fixed("显示或调整角色"),
    assetIds: noAssets,
  },
  removeCharacter: {
    label: "移除立绘",
    category: "character",
    timing: "point",
    renpyKeyword: "hide",
    defaults: () => ({ all: false }),
    summary: fixed("移除舞台角色"),
    assetIds: noAssets,
  },
  showCg: {
    label: "显示 CG",
    category: "stage",
    timing: "point",
    renpyKeyword: "studio showCg",
    defaults: () => ({ displayMode: "fullscreen", fit: "cover" }),
    summary: fixed("显示剧情 CG"),
    assetIds: noAssets,
  },
  hideCg: {
    label: "隐藏 CG",
    category: "stage",
    timing: "point",
    renpyKeyword: "studio hideCg",
    defaults: () => ({}),
    summary: fixed("隐藏剧情 CG"),
    assetIds: noAssets,
  },
  camera: {
    label: "镜头",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio camera",
    defaults: () => ({
      target: "stage",
      effect: "move",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      intensity: 1,
      durationMs: 500,
      easing: "easeInOut",
      waitForCompletion: false,
    }),
    summary: fixed("镜头运动或效果"),
    assetIds: noAssets,
  },
  resetCamera: {
    label: "镜头复位",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio resetCamera",
    defaults: () => ({ durationMs: 300, waitForCompletion: false }),
    summary: fixed("恢复默认镜头"),
    assetIds: noAssets,
  },
  audio: {
    label: "声音",
    category: "stage",
    timing: "point",
    renpyKeyword: "play",
    defaults: () => ({
      action: "play",
      channel: "sfx",
      volume: 100,
      loop: false,
      fadeMs: 0,
    }),
    summary: fixed("播放或停止声音"),
    assetIds: asset(),
  },
  particle: {
    label: "粒子",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio particle",
    defaults: () => ({
      preset: "rain",
      action: "play",
      density: 1,
      durationMs: null,
      waitForCompletion: false,
    }),
    summary: fixed("播放或停止粒子"),
    assetIds: noAssets,
  },
  stageAnimation: {
    label: "镜头动画",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio stageAnimation",
    defaults: () => ({
      target: "stage",
      animation: "fade",
      durationMs: 500,
      waitForCompletion: false,
    }),
    summary: fixed("播放舞台动画"),
    assetIds: noAssets,
  },
  floatingText: {
    label: "浮动文字",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio floatingText",
    defaults: () => ({
      text: "",
      x: 50,
      y: 50,
      color: "#FFFFFF",
      durationMs: 1500,
      waitForCompletion: false,
    }),
    summary: text(),
    assetIds: noAssets,
  },
  curtain: {
    label: "幕布",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio curtain",
    defaults: () => ({
      action: "show",
      color: "#000000",
      opacity: 1,
      durationMs: 400,
      waitForCompletion: false,
    }),
    summary: fixed("显示或隐藏幕布"),
    assetIds: noAssets,
  },
  video: {
    label: "视频",
    category: "stage",
    timing: "duration",
    renpyKeyword: "studio video",
    defaults: () => ({
      action: "play",
      loop: false,
      volume: 100,
      fit: "cover",
      waitForCompletion: true,
    }),
    summary: fixed("播放或停止视频"),
    assetIds: asset(),
  },
  animateSprite: {
    label: "精灵动画",
    category: "character",
    timing: "duration",
    renpyKeyword: "studio animateSprite",
    defaults: () => ({
      animation: "idle",
      durationMs: 500,
      loop: false,
      waitForCompletion: false,
    }),
    summary: fixed("播放角色精灵动画"),
    assetIds: noAssets,
  },
  autoPlay: {
    label: "自动播放",
    category: "stage",
    timing: "flow",
    renpyKeyword: "studio autoPlay",
    defaults: () => ({ enabled: true, delayMs: 1200 }),
    summary: fixed("切换自动播放"),
    assetIds: noAssets,
  },
  switchDialogueStyle: {
    label: "对话框样式",
    category: "stage",
    timing: "flow",
    renpyKeyword: "studio switchDialogueStyle",
    defaults: () => ({ preset: "dark" }),
    summary: fixed("切换对话框样式"),
    assetIds: noAssets,
  },
  portraitStyleRule: {
    label: "立绘发言状态",
    category: "character",
    timing: "flow",
    renpyKeyword: "studio portraitStyleRule",
    defaults: () => ({ mode: "stage", keepAfter: true }),
    summary: fixed("调整发言立绘规则"),
    assetIds: noAssets,
  },
  gallery: {
    label: "鉴赏",
    category: "logic",
    timing: "flow",
    renpyKeyword: "studio gallery",
    defaults: () => ({ action: "unlockCg" }),
    summary: fixed("解锁鉴赏内容"),
    assetIds: asset(),
  },
  branch: {
    label: "选项",
    category: "logic",
    timing: "flow",
    renpyKeyword: "menu",
    defaults: () => ({ prompt: "你要怎么选择？", choices: [] }),
    summary: fixed("显示分支选项后调用目标 Fragment"),
    assetIds: noAssets,
  },
  if: {
    label: "条件",
    category: "logic",
    timing: "flow",
    renpyKeyword: "if",
    defaults: () => ({ condition: "", elseFragmentId: null }),
    summary: fixed("按条件调用 Fragment"),
    assetIds: noAssets,
  },
  setVariable: {
    label: "变量赋值",
    category: "logic",
    timing: "flow",
    renpyKeyword: "$",
    defaults: () => ({ operator: "set", value: null }),
    summary: fixed("更新项目变量"),
    assetIds: noAssets,
  },
  callFragment: {
    label: "调用 Fragment",
    category: "logic",
    timing: "flow",
    renpyKeyword: "call",
    defaults: () => ({}),
    summary: fixed("调用后返回当前位置"),
    assetIds: noAssets,
  },
  endChapter: {
    label: "结束章节",
    category: "logic",
    timing: "terminal",
    renpyKeyword: "studio endChapter",
    defaults: () => ({ endingId: null, label: "结束章节" }),
    summary: fixed("进入下一启用章节"),
    assetIds: noAssets,
  },
  returnToEntry: {
    label: "返回入口章",
    category: "logic",
    timing: "terminal",
    renpyKeyword: "studio returnToEntry",
    defaults: () => ({}),
    summary: fixed("重置状态并返回入口章"),
    assetIds: noAssets,
  },
} satisfies Record<GalgameStoryBlock["type"], BlockCapability>;

export const BLOCK_CATEGORIES: Array<{ id: BlockCategory; label: string }> = [
  { id: "character", label: "角色" },
  { id: "text", label: "文本" },
  { id: "stage", label: "演出" },
  { id: "logic", label: "逻辑" },
];

export function blockCapability(block: GalgameStoryBlock) {
  return BLOCK_REGISTRY[block.type] as BlockCapability;
}

export function blockSummary(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
) {
  return blockCapability(block).summary(block, document);
}

export function canonicalBlockJson(blocks: GalgameStoryBlock[]) {
  return JSON.stringify(blocks, null, 2);
}
