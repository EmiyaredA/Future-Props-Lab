/* eslint-disable react-refresh/only-export-components -- shared card presentation registry */
import {
  Activity,
  AlignLeft,
  AudioLines,
  BadgeInfo,
  BellRing,
  Blend,
  BookOpen,
  Braces,
  Camera,
  Clock3,
  CircleCheck,
  CircleStop,
  Clapperboard,
  ContactRound,
  CornerDownLeft,
  Eraser,
  Eye,
  EyeOff,
  Flag,
  FlipHorizontal2,
  Film,
  Frame,
  GalleryHorizontal,
  Gauge,
  GitBranch,
  GitMerge,
  Hourglass,
  ImageOff,
  ImagePlus,
  Layers2,
  MapPinned,
  Maximize2,
  MessageCircle,
  MessageCircleMore,
  MonitorPlay,
  Music2,
  Palette,
  PanelsTopLeft,
  PlayCircle,
  Quote,
  RectangleHorizontal,
  RectangleVertical,
  Repeat2,
  RotateCcw,
  ScanFace,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  StickyNote,
  Subtitles,
  SunMedium,
  Target,
  Timer,
  Undo2,
  UserRound,
  UserRoundMinus,
  UserRoundPlus,
  Users,
  Variable,
  Volume2,
  WandSparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryChapter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { BlockKind } from "@features/galgame-workshop/editor/model";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";

export const BLOCK_LABELS = Object.fromEntries(
  Object.entries(BLOCK_REGISTRY).map(([type, capability]) => [
    type,
    capability.label,
  ]),
) as Record<BlockKind, string>;

export const AUDIO_LABELS = {
  bgm: "背景音乐",
  ambient: "环境音",
  sfx: "音效",
} as const;

export type AudioChannel = keyof typeof AUDIO_LABELS;

const BLOCK_ICONS = {
  narration: Quote,
  dialogue: MessageCircleMore,
  storyParagraph: AlignLeft,
  paragraphParams: SlidersHorizontal,
  systemMessage: BellRing,
  comment: StickyNote,
  wait: Clock3,
  scene: MapPinned,
  destroyScene: Eraser,
  showCharacter: UserRoundPlus,
  setStageCast: Users,
  removeCharacter: UserRoundMinus,
  showCg: ImagePlus,
  hideCg: ImageOff,
  camera: Camera,
  resetCamera: RotateCcw,
  audio: Music2,
  particle: Sparkles,
  stageAnimation: Clapperboard,
  floatingText: Subtitles,
  curtain: EyeOff,
  video: Film,
  animateSprite: PlayCircle,
  autoPlay: MonitorPlay,
  switchDialogueStyle: PanelsTopLeft,
  portraitStyleRule: UserRound,
  gallery: GalleryHorizontal,
  branch: GitBranch,
  if: GitMerge,
  setVariable: Variable,
  callFragment: Workflow,
  endChapter: Flag,
  returnToEntry: Undo2,
} satisfies Record<BlockKind, LucideIcon>;

export function blockIcon(type: BlockKind) {
  const Icon = BLOCK_ICONS[type];
  return <Icon aria-hidden />;
}

/**
 * Context settings need their own semantic glyphs. A dialogue card can have
 * portrait, visibility, voice, and timing commands side by side; repeating
 * the card's main icon for all of them hides those differences.
 */
export function contextSettingIcon(
  settingId: string,
  label: string,
  sectionLabel: string,
  blockType: BlockKind,
) {
  const key = settingId
    .replace(`context-${blockType}-`, "")
    .toLocaleLowerCase("en-US");
  const text = `${key} ${label} ${sectionLabel}`.toLocaleLowerCase("zh-CN");
  let Icon: LucideIcon = Settings2;
  if (key === "mode-fullscreen") Icon = Maximize2;
  else if (key === "mode-letterbox") Icon = RectangleHorizontal;
  else if (key === "mode-pillarbox") Icon = RectangleVertical;
  else if (key === "mode-frame") Icon = Frame;
  else if (key === "action-show") Icon = EyeOff;
  else if (key === "action-hide") Icon = Eye;
  else if (key === "duration-0") Icon = Zap;
  else if (key.startsWith("duration-")) Icon = Timer;
  else if (key === "action-play") Icon = PlayCircle;
  else if (key === "action-stop") Icon = CircleStop;
  else if (key === "loop") Icon = Repeat2;
  else if (key === "wait") Icon = Hourglass;
  else if (/portrait|立绘|角色|头像/.test(text))
    Icon =
      key.includes("solo") || label.includes("单人")
        ? ScanFace
        : key.includes("dialogueavatar") || label.includes("对白")
          ? ContactRound
          : UserRound;
  else if (/hide-dialogue|对话框|对白后/.test(text)) Icon = MessageCircle;
  else if (/voice|配音|音量|声音|audio/.test(text)) Icon = Volume2;
  else if (/channel|通道/.test(text)) Icon = AudioLines;
  else if (/duration|时长|delay|延迟|等待|wait/.test(text)) Icon = Timer;
  else if (/speed|速度|速率/.test(text)) Icon = Gauge;
  else if (/fade|淡入|淡出|transition/.test(text)) Icon = Blend;
  else if (/flip|翻转/.test(text)) Icon = FlipHorizontal2;
  else if (/position|位置|target|目标/.test(text)) Icon = Target;
  else if (/fit|适配|placement|层级|叠放/.test(text)) Icon = ScanLine;
  else if (/loop|循环/.test(text)) Icon = Repeat2;
  else if (/preset|预设|样式|主题/.test(text)) Icon = Palette;
  else if (/density|密度/.test(text)) Icon = Layers2;
  else if (/continuous|持续/.test(text)) Icon = Activity;
  else if (/volume|opacity|不透明|亮度|颜色/.test(text)) Icon = SunMedium;
  else if (/clear|清空|销毁/.test(text)) Icon = Eraser;
  else if (/operator|运算|变量/.test(text)) Icon = Braces;
  else if (/unlock|鉴赏/.test(text)) Icon = GalleryHorizontal;
  else if (/condition|条件/.test(text)) Icon = GitMerge;
  else if (/branch|选项/.test(text)) Icon = GitBranch;
  else if (/call|调用|fragment/.test(text)) Icon = CornerDownLeft;
  else if (/end|结束/.test(text)) Icon = Flag;
  else if (/return|返回/.test(text)) Icon = Undo2;
  else if (/action|动作|开启|关闭|播放|停止/.test(text)) Icon = CircleCheck;
  else if (/reveal|呈现|显示/.test(text)) Icon = WandSparkles;
  else if (/read|已读|历史/.test(text)) Icon = BookOpen;
  else if (/easing|缓动|控制/.test(text)) Icon = SlidersVertical;
  else if (/mode|模式|tone|语义/.test(text)) Icon = BadgeInfo;
  else if (/stop|停止/.test(text)) Icon = CircleStop;
  return <Icon aria-hidden />;
}

export function blockSummary(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
  chapter: GalgameStoryChapter,
) {
  if (block.type === "scene")
    return (
      document.scenes?.find((scene) => scene.id === block.sceneId)?.name ??
      "未知场景"
    );
  if (block.type === "showCg")
    return (
      document.cgs?.find((candidate) => candidate.id === block.cgId)?.name ??
      "未知 CG"
    );
  if (block.type === "hideCg") return "隐藏当前剧情 CG";
  if (block.type === "showCharacter")
    return `登场 · ${
      document.characters?.find(
        (character) => character.id === block.characterId,
      )?.name ?? "未知角色"
    }`;
  if (block.type === "removeCharacter")
    return block.all
      ? "全部角色退场"
      : `退场 · ${
          document.characters?.find(
            (character) => character.id === block.characterId,
          )?.name ?? "未知角色"
        }`;
  if (block.type === "audio") {
    if (block.action === "stop") return `停止${AUDIO_LABELS[block.channel]}`;
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === block.assetId,
    );
    return asset?.type === "audio" ? asset.label : "未绑定声音";
  }
  if (block.type === "branch")
    return block.choices
      .map((choice) => {
        const target = chapter.fragments?.find(
          (fragment) => fragment.id === choice.targetFragmentId,
        );
        return `${choice.text || "未命名选项"} → ${target?.title ?? "未知目标"}`;
      })
      .join(" · ");
  if (block.type === "endChapter") return block.label;
  return "";
}

export function blockPreviewFileId(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
) {
  let assetId: string | undefined;
  if (block.type === "scene") {
    const scene = document.scenes?.find(
      (candidate) => candidate.id === block.sceneId,
    );
    assetId = scene?.layers?.[0]?.assetId;
  } else if (block.type === "showCg") {
    const cg = document.cgs?.find((candidate) => candidate.id === block.cgId);
    const variant = cg?.variants?.find(
      (candidate) => candidate.id === (block.variantId ?? cg.defaultVariantId),
    );
    assetId = variant?.assetId;
  }
  return document.assets?.find((candidate) => candidate.id === assetId)?.fileId;
}
