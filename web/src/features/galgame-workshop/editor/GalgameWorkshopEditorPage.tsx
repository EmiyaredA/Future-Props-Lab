import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AlignLeft,
  BookOpenText,
  Braces,
  ChevronDown,
  Clock3,
  Code2,
  Copy,
  Flag,
  GitBranch,
  Images,
  MapPinned,
  MessageSquareText,
  MoreHorizontal,
  Music2,
  Palette,
  Plus,
  Play,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import {
  applyGalgamePortraitUpgrade,
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  patchGalgameWorkshopProject,
  putGalgameStoryDocument,
  repairGalgameMissingAsset,
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryCgTransition,
  type GalgameStoryDocument,
  type GalgameStoryFragment,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { DialogueVoiceBinding } from "@features/galgame-workshop/editor/DialogueVoiceBinding";
import {
  CharacterTransformFields,
  CharacterTransitionFields,
} from "@features/galgame-workshop/editor/CharacterStageControls";
import { CgOverlayTransformFields } from "@features/galgame-workshop/editor/CgStageControls";
import {
  dialogueSpeakerIds,
  withDialogueSpeakers,
} from "@features/galgame-workshop/editor/dialogue";
import { StoryTimelineEditor } from "@features/galgame-workshop/editor/StoryTimelineEditor";
import { StoryBlockEditor } from "@features/galgame-workshop/editor/StoryBlockEditor";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  JsonStoryView,
  PlainStoryView,
  RenpyStoryView,
} from "@features/galgame-workshop/editor/StoryTextViews";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { TimelinePlayheadAddMenu } from "@features/galgame-workshop/editor/TimelinePlayheadAddMenu";
import {
  canMoveStoryBlockBundle,
  continuingDialogueBlock,
  deleteStoryBlockBundle,
  insertStoryBlock,
  moveStoryBlockBundle,
  storyBlockBundles,
} from "@features/galgame-workshop/editor/blockFlow";
import {
  loadTimelinePreferences,
  storeTimelinePreferences,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import {
  loadStageViewportPreferences,
  storeStageViewportPreferences,
} from "@features/galgame-workshop/editor/stageViewportPreferences";
import {
  DEFAULT_SCRIPT_LAYOUT,
  loadScriptLayout,
  normalizeScriptLayout,
  storeScriptLayout,
  type ScriptLayoutPreferences,
} from "@features/galgame-workshop/editor/scriptLayoutPreferences";
import {
  completeStoryDocument,
  chapterById,
  entryChapter,
  fragmentById,
  isTerminator,
  makeBlock,
  makeAudioBlock,
  referencedBy,
  stableId,
  type BlockKind,
  type AssetSection,
  type EditorWorkspace,
  updateChapter,
  updateBlock,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  StoryPlayer,
  type StoryPlayerHandle,
} from "@features/galgame-workshop/editor/StoryPlayer";
import {
  cgOverlay,
  characterTransform,
  DEFAULT_CG_OVERLAY,
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
  replayStageToBlock,
} from "@features/galgame-workshop/editor/stage";
import {
  attachTimelineCharacterEvent,
  appendBlockToTimeline,
  effectivePointTime,
  formatTimecode,
  parseTimecode,
  projectFragmentTimeline,
  resizeTimelineCueEnd,
  setTimelineCgRangeEdge,
  setTimelineCueEdge,
  setTimelineGapEdge,
  setTimelinePointTime,
  timelineCgRanges,
  timelineCharacterTiming,
  timelineGaps,
  type GalgameTimelineGap,
} from "@features/galgame-workshop/editor/timeline";
import { AssetCenter } from "@features/galgame-workshop/editor/AssetCenter";
import { DialogueStyleInspector } from "@features/galgame-workshop/editor/DialogueStyleInspector";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import {
  GlobalStorySearch,
  type StorySearchTarget,
} from "@features/galgame-workshop/editor/GlobalStorySearch";
import { NarrativeMapWorkspace } from "@features/galgame-workshop/editor/NarrativeMapWorkspace";
import {
  PersonalizationWorkspace,
  ProjectSettingsWorkspace,
} from "@features/galgame-workshop/editor/ProjectWorkspaces";
import {
  RouteReportDialog,
  RouteReportInspector,
  type GalgameStoryReportIssue,
  type StoryRoute,
} from "@features/galgame-workshop/editor/RouteReport";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";

const STORY_KEY = (projectId: string) =>
  ["galgame-workshop-story", projectId] as const;
const REPORT_KEY = (projectId: string) =>
  ["galgame-workshop-story-report", projectId] as const;
const PROJECT_KEY = (projectId: string) =>
  ["galgame-workshop-project", projectId] as const;

type SaveState = "saved" | "saving" | "error" | "conflict";
type InspectorTab = "properties" | "appearance" | "report";
type ScriptView = "blocks" | "plain" | "renpy" | "json" | "performance";

const WORKSPACES: Array<{
  id: EditorWorkspace;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { id: "script", label: "剧本", icon: BookOpenText },
  { id: "assets", label: "资产", icon: Images },
  { id: "narrative", label: "叙事地图", icon: GitBranch },
  { id: "personalization", label: "个性化", icon: Palette },
  { id: "settings", label: "设置", icon: Settings2 },
];

const BLOCK_LABELS = Object.fromEntries(
  Object.entries(BLOCK_REGISTRY).map(([type, capability]) => [
    type,
    capability.label,
  ]),
) as Record<BlockKind, string>;

const SCRIPT_VIEW_KEY = "future_props_galgame_editor_script_view";
const selectedBlockKey = (projectId: string, fragmentId: string) =>
  `future_props_galgame_selected_block:${projectId}:${fragmentId}`;
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadScriptView(): ScriptView {
  const stored = localStorage.getItem(SCRIPT_VIEW_KEY);
  return stored === "plain" ||
    stored === "renpy" ||
    stored === "json" ||
    stored === "performance"
    ? stored
    : "blocks";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "故事已在其他页面更新，请选择要保留的版本。";
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="galgame-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CgTransitionFields({
  transition,
  onChange,
}: {
  transition?: GalgameStoryCgTransition;
  onChange: (transition: GalgameStoryCgTransition) => void;
}) {
  const value = { durationMs: 400, fade: true, ...transition };
  return (
    <div className="galgame-character-transition-fields">
      <label>
        <input
          type="checkbox"
          checked={value.fade}
          onChange={(event) =>
            onChange({ ...value, fade: event.target.checked })
          }
        />
        <span>CG 淡入淡出</span>
      </label>
      <label className="galgame-stage-range">
        <span>
          过渡时长 <em>{value.durationMs}ms</em>
        </span>
        <input
          aria-label="CG 过渡时长"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={value.durationMs}
          onChange={(event) =>
            onChange({
              ...value,
              durationMs: Number(event.target.value),
            })
          }
        />
      </label>
    </div>
  );
}

function TimecodeField({
  label,
  value,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (milliseconds: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => formatTimecode(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(formatTimecode(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <label className={`galgame-field${invalid ? " invalid" : ""}`}>
      <span>{label}</span>
      <input
        disabled={disabled}
        value={draft}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder="00:00.000"
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setDraft(formatTimecode(value));
            setInvalid(false);
          }
        }}
      />
      {invalid ? <small>请输入 mm:ss.mmm 格式</small> : null}
    </label>
  );
}

function BlockTypeIcon({ type }: { type: BlockKind }) {
  if (type === "scene") return <MapPinned aria-hidden />;
  if (type === "showCg" || type === "hideCg") return <Images aria-hidden />;
  if (
    type === "dialogue" ||
    type === "showCharacter" ||
    type === "removeCharacter"
  )
    return <UserRound aria-hidden />;
  if (type === "audio") return <Music2 aria-hidden />;
  if (type === "branch") return <GitBranch aria-hidden />;
  if (type === "endChapter") return <Flag aria-hidden />;
  return <MessageSquareText aria-hidden />;
}

function ChapterCast({
  document,
  chapter,
}: {
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
}) {
  const characterIds = Array.from(
    new Set(
      (chapter.fragments ?? []).flatMap((fragment) =>
        (fragment.blocks ?? []).flatMap((block) => {
          if (
            block.type === "dialogue" ||
            block.type === "showCharacter" ||
            (block.type === "removeCharacter" && !block.all)
          )
            return block.characterId ? [block.characterId] : [];
          return [];
        }),
      ),
    ),
  ).slice(0, 3);
  if (!characterIds.length) return null;
  return (
    <span className="galgame-chapter-cast" aria-label="章节角色">
      {characterIds.map((characterId) => {
        const character = (document.characters ?? []).find(
          (candidate) => candidate.id === characterId,
        );
        const expression = character?.expressions?.find(
          (candidate) => candidate.id === character.defaultExpressionId,
        );
        const asset = document.assets?.find(
          (candidate) => candidate.id === expression?.assetId,
        );
        return (
          <span
            key={characterId}
            title={character?.name}
            style={
              { "--chapter-cast-color": character?.themeColor } as CSSProperties
            }
          >
            <StoryAssetImage
              fileId={asset?.fileId}
              alt=""
              fallback={<b>{character?.name.slice(0, 1) ?? "角"}</b>}
            />
          </span>
        );
      })}
    </span>
  );
}

function FragmentOverviewInspector({
  fragment,
  durationMs,
  isEntry,
  estimated,
}: {
  fragment: GalgameStoryFragment;
  durationMs: number;
  isEntry: boolean;
  estimated: boolean;
}) {
  return (
    <div className="galgame-fragment-overview">
      <header>
        <span>
          <small>FRAGMENT</small>
          <strong>{fragment.title}</strong>
        </span>
        {isEntry ? <em>入口</em> : null}
      </header>
      <div className="galgame-fragment-overview-metrics">
        <span>
          <Clock3 aria-hidden />
          <small>{estimated ? "估算时长" : "剧情时长"}</small>
          <strong>{formatTimecode(durationMs)}</strong>
        </span>
        <span>
          <BookOpenText aria-hidden />
          <small>Block 数量</small>
          <strong>{fragment.blocks?.length ?? 0}</strong>
        </span>
      </div>
      <footer>
        <Settings2 aria-hidden />
        <span>
          <strong>选择时间轴内容项以编辑</strong>
          <small>可以直接选择对白、舞台、声音或无对白区间。</small>
        </span>
      </footer>
    </div>
  );
}
function BlockInspector({
  projectId,
  block,
  document,
  chapter,
  fragmentId,
  onDocument,
  onNotice,
  voiceStale,
  onVoiceStale,
  onVoiceFresh,
  timelinePreferences,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
}: {
  projectId: string;
  block?: GalgameStoryBlock;
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragmentId: string;
  onDocument: (document: GalgameStoryProject) => void;
  onNotice: (message: string) => void;
  voiceStale: boolean;
  onVoiceStale: () => void;
  onVoiceFresh: () => void;
  timelinePreferences: TimelinePreferences;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  if (!block)
    return (
      <div className="galgame-inspector-empty">
        <Settings2 aria-hidden />
        <strong>未选择 Block</strong>
        <span>在中间的剧本流中选择一个 Block 后编辑属性。</span>
      </div>
    );

  const patch = (updater: (current: GalgameStoryBlock) => GalgameStoryBlock) =>
    onDocument(updateBlock(document, fragmentId, block.id, updater));
  const fragment = chapter.fragments?.find((item) => item.id === fragmentId);
  const blockIndex = fragment?.blocks?.findIndex(
    (item) => item.id === block.id,
  );
  const pointTime =
    fragment && blockIndex != null && blockIndex >= 0
      ? effectivePointTime(fragment, blockIndex)
      : undefined;
  const cgRange =
    fragment && block.type === "showCg"
      ? timelineCgRanges(fragment).find(
          (range) => range.showBlock.id === block.id,
        )
      : undefined;
  const characterTiming =
    fragment &&
    (block.type === "showCharacter" || block.type === "removeCharacter")
      ? timelineCharacterTiming(fragment, block.id)
      : undefined;
  const dialogueTargets =
    fragment?.blocks?.filter((candidate) => candidate.type === "dialogue") ??
    [];

  return (
    <div className="galgame-block-inspector">
      <header>
        <span className={`galgame-block-kind is-${block.type}`}>
          <BlockTypeIcon type={block.type} />
        </span>
        <span>
          <strong>{BLOCK_LABELS[block.type]}</strong>
          <small>{block.id}</small>
        </span>
        <nav className="galgame-block-order-actions" aria-label="执行顺序">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label="提前执行"
          >
            <ArrowUp aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="延后执行"
          >
            <ArrowDown aria-hidden />
          </button>
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            aria-label="删除事件"
          >
            <Trash2 aria-hidden />
          </button>
        </nav>
      </header>
      {(block.type === "dialogue" ||
        block.type === "narration" ||
        block.type === "storyParagraph" ||
        block.type === "systemMessage") &&
      block.startMs != null &&
      block.endMs != null ? (
        <div className="galgame-block-timing" aria-label="对白时间范围">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>剧情时间轴</strong>
              <small>时长 {formatTimecode(block.endMs - block.startMs)}</small>
            </span>
          </header>
          <div>
            <TimecodeField
              label="对白开始时间"
              value={block.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (fragment) =>
                    setTimelineCueEdge(
                      fragment,
                      block.id,
                      "start",
                      milliseconds,
                      true,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="对白结束时间"
              value={block.endMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (fragment) =>
                    resizeTimelineCueEnd(fragment, block.id, milliseconds, {
                      precise: true,
                      ripple: timelinePreferences.ripple,
                      keepContinuous: true,
                    }),
                  ),
                )
              }
            />
          </div>
        </div>
      ) : null}
      {block.type === "showCg" && fragment?.timeline && cgRange ? (
        <div className="galgame-block-timing" aria-label="CG 显示时间范围">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>CG 显示时间</strong>
              <small>
                时长 {formatTimecode(cgRange.endMs - cgRange.startMs)}
              </small>
            </span>
          </header>
          <div>
            <TimecodeField
              label="CG 开始时间"
              value={cgRange.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "start",
                      milliseconds,
                      true,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="CG 结束时间"
              value={cgRange.endMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "end",
                      milliseconds,
                      true,
                      stableId,
                    ),
                  ),
                )
              }
            />
            <TimecodeField
              label="CG 持续时间"
              value={cgRange.endMs - cgRange.startMs}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelineCgRangeEdge(
                      current,
                      block.id,
                      "end",
                      cgRange.startMs + milliseconds,
                      true,
                      stableId,
                    ),
                  ),
                )
              }
            />
          </div>
        </div>
      ) : null}
      {(block.type === "showCharacter" || block.type === "removeCharacter") &&
      fragment?.timeline &&
      pointTime != null &&
      characterTiming ? (
        <div className="galgame-block-timing" aria-label="角色演出时间设置">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>角色演出时间</strong>
              <small>
                {characterTiming.mode === "independent"
                  ? "独立演出"
                  : characterTiming.mode === "dialogue"
                    ? "跟随对白"
                    : "跟随剧情结尾"}
              </small>
            </span>
          </header>
          <Field label="时间关系">
            <CustomSelect
              ariaLabel="角色演出时间关系"
              value={
                characterTiming.mode === "dialogue"
                  ? `dialogue:${characterTiming.dialogueBlockId}`
                  : characterTiming.mode
              }
              options={[
                { value: "independent", label: "独立时间" },
                ...(characterTiming.mode === "timelineEnd"
                  ? [
                      {
                        value: "timelineEnd",
                        label: "跟随剧情结尾",
                      },
                    ]
                  : []),
                ...dialogueTargets.map((dialogue, index) => {
                  const speaker = (document.characters ?? []).find(
                    (character) => character.id === dialogue.characterId,
                  );
                  const summary = dialogue.text.trim() || "未填写对白";
                  return {
                    value: `dialogue:${dialogue.id}`,
                    label: `跟随对白 ${index + 1} · ${speaker?.name ?? "未知角色"}：${summary}`,
                  };
                }),
              ]}
              onChange={(value) => {
                if (value === "independent") {
                  onDocument(
                    updateFragment(document, fragmentId, (current) =>
                      setTimelinePointTime(current, block.id, pointTime, true),
                    ),
                  );
                  return;
                }
                if (!value.startsWith("dialogue:")) return;
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    attachTimelineCharacterEvent(
                      current,
                      block.id,
                      value.slice("dialogue:".length),
                    ),
                  ),
                );
              }}
            />
          </Field>
          {characterTiming.mode === "independent" ? (
            <TimecodeField
              label="触发时间"
              value={pointTime}
              onCommit={(milliseconds) =>
                onDocument(
                  updateFragment(document, fragmentId, (current) =>
                    setTimelinePointTime(current, block.id, milliseconds, true),
                  ),
                )
              }
            />
          ) : (
            <small className="galgame-field-hint">
              {characterTiming.mode === "dialogue"
                ? "移动目标对白时，角色演出会一起移动。"
                : "当前 Fragment 没有后续对白，角色演出跟随剧情结尾。"}
            </small>
          )}
        </div>
      ) : null}
      {(block.type === "scene" ||
        block.type === "hideCg" ||
        block.type === "audio") &&
      fragment?.timeline &&
      pointTime != null ? (
        <div className="galgame-block-timing" aria-label="演出事件时间点">
          <header>
            <Clock3 aria-hidden />
            <span>
              <strong>演出时间点</strong>
              <small>{block.atMs == null ? "兼容锚点" : "显式锚点"}</small>
            </span>
          </header>
          <TimecodeField
            label="触发时间"
            value={pointTime}
            onCommit={(milliseconds) =>
              onDocument(
                updateFragment(document, fragmentId, (current) =>
                  setTimelinePointTime(current, block.id, milliseconds, true),
                ),
              )
            }
          />
        </div>
      ) : null}
      {block.type === "scene" ? (
        <>
          <Field label="切换场景">
            <CustomSelect
              ariaLabel="切换场景"
              value={block.sceneId}
              options={(document.scenes ?? []).map((scene) => ({
                value: scene.id,
                label: scene.name,
              }))}
              onChange={(sceneId) =>
                patch((current) =>
                  current.type === "scene"
                    ? {
                        ...current,
                        sceneId,
                      }
                    : current,
                )
              }
            />
          </Field>
          <p className="galgame-block-editor-hint">
            场景的全部图层会按资源工作区中的顺序渲染；镜头预览不会写入此 Block。
          </p>
          <label className="galgame-stage-checkbox">
            <input
              type="checkbox"
              checked={block.clearCharacters !== false}
              onChange={(event) =>
                patch((current) =>
                  current.type === "scene"
                    ? { ...current, clearCharacters: event.target.checked }
                    : current,
                )
              }
            />
            <span>切换场景时清空舞台角色</span>
          </label>
        </>
      ) : block.type === "showCg" ? (
        <>
          <Field label="剧情 CG">
            <CustomSelect
              ariaLabel="显示剧情 CG"
              value={block.cgId}
              options={(document.cgs ?? [])
                .filter((cg) =>
                  (cg.variants ?? []).some(
                    (variant) => variant.id === cg.defaultVariantId,
                  ),
                )
                .map((cg) => ({ value: cg.id, label: cg.name }))}
              onChange={(cgId) =>
                patch((current) =>
                  current.type === "showCg"
                    ? { ...current, cgId, variantId: null }
                    : current,
                )
              }
            />
          </Field>
          <Field label="CG 差分">
            <CustomSelect
              ariaLabel="CG 差分"
              value={block.variantId ?? ""}
              options={(() => {
                const cg = (document.cgs ?? []).find(
                  (candidate) => candidate.id === block.cgId,
                );
                const defaultVariant = (cg?.variants ?? []).find(
                  (variant) => variant.id === cg?.defaultVariantId,
                );
                return [
                  {
                    value: "",
                    label: `跟随默认 · ${defaultVariant?.label ?? "未绑定"}`,
                  },
                  ...(cg?.variants ?? []).map((variant) => ({
                    value: variant.id,
                    label: variant.label,
                  })),
                ];
              })()}
              onChange={(variantId) =>
                patch((current) =>
                  current.type === "showCg"
                    ? { ...current, variantId: variantId || null }
                    : current,
                )
              }
            />
          </Field>
          <Field label="显示模式">
            <CustomSelect
              ariaLabel="CG 显示模式"
              value={block.displayMode ?? "fullscreen"}
              options={[
                { value: "fullscreen", label: "全屏 CG" },
                { value: "overlay", label: "叠加 CG" },
              ]}
              onChange={(displayMode) =>
                patch((current) =>
                  current.type === "showCg"
                    ? {
                        ...current,
                        displayMode: displayMode as "fullscreen" | "overlay",
                        overlay: current.overlay ?? DEFAULT_CG_OVERLAY,
                      }
                    : current,
                )
              }
            />
          </Field>
          {(block.displayMode ?? "fullscreen") === "fullscreen" ? (
            <Field label="画面适配">
              <CustomSelect
                ariaLabel="CG 画面适配"
                value={block.fit}
                options={[
                  { value: "cover", label: "铺满裁切" },
                  { value: "contain", label: "完整显示（黑边）" },
                ]}
                onChange={(fit) =>
                  patch((current) =>
                    current.type === "showCg"
                      ? { ...current, fit: fit as "cover" | "contain" }
                      : current,
                  )
                }
              />
            </Field>
          ) : (
            <>
              <Field label="叠放位置">
                <CustomSelect
                  ariaLabel="CG 叠放位置"
                  value={cgOverlay(block.overlay).placement}
                  options={[
                    { value: "behindCharacters", label: "角色后方" },
                    { value: "frontOfCharacters", label: "角色前方" },
                  ]}
                  onChange={(placement) =>
                    patch((current) =>
                      current.type === "showCg"
                        ? {
                            ...current,
                            overlay: {
                              ...cgOverlay(current.overlay),
                              placement: placement as
                                "behindCharacters" | "frontOfCharacters",
                            },
                          }
                        : current,
                    )
                  }
                />
              </Field>
              <CgOverlayTransformFields
                overlay={block.overlay}
                onChange={(overlay) =>
                  patch((current) =>
                    current.type === "showCg"
                      ? { ...current, overlay }
                      : current,
                  )
                }
              />
            </>
          )}
          <CgTransitionFields
            transition={block.transition}
            onChange={(transition) =>
              patch((current) =>
                current.type === "showCg"
                  ? { ...current, transition }
                  : current,
              )
            }
          />
        </>
      ) : block.type === "hideCg" ? (
        <CgTransitionFields
          transition={block.transition}
          onChange={(transition) =>
            patch((current) =>
              current.type === "hideCg" ? { ...current, transition } : current,
            )
          }
        />
      ) : block.type === "showCharacter" ? (
        <>
          <Field label="登场 / 调整角色">
            <CustomSelect
              ariaLabel="登场或调整角色"
              value={block.characterId}
              options={(document.characters ?? []).map((character) => ({
                value: character.id,
                label: character.name,
              }))}
              onChange={(characterId) =>
                patch((current) =>
                  current.type === "showCharacter"
                    ? { ...current, characterId, expressionId: null }
                    : current,
                )
              }
            />
          </Field>
          <Field label="立绘表情">
            <CustomSelect
              ariaLabel="登场角色表情"
              value={block.expressionId ?? ""}
              options={[
                { value: "", label: "跟随角色默认表情" },
                ...(
                  document.characters?.find(
                    (character) => character.id === block.characterId,
                  )?.expressions ?? []
                ).map((expression) => ({
                  value: expression.id,
                  label: expression.label,
                })),
              ]}
              onChange={(expressionId) =>
                patch((current) =>
                  current.type === "showCharacter"
                    ? { ...current, expressionId: expressionId || null }
                    : current,
                )
              }
            />
          </Field>
          <CharacterTransformFields
            transform={block.transform}
            transition={block.transition}
            onTransform={(transform) =>
              patch((current) =>
                current.type === "showCharacter"
                  ? { ...current, transform }
                  : current,
              )
            }
            onTransition={(transition) =>
              patch((current) =>
                current.type === "showCharacter"
                  ? { ...current, transition }
                  : current,
              )
            }
          />
        </>
      ) : block.type === "removeCharacter" ? (
        <>
          <Field label="退场目标">
            <CustomSelect
              ariaLabel="退场目标"
              value={block.all ? "__all__" : (block.characterId ?? "")}
              options={[
                { value: "__all__", label: "全部角色" },
                ...(document.characters ?? []).map((character) => ({
                  value: character.id,
                  label: character.name,
                })),
              ]}
              onChange={(target) =>
                patch((current) =>
                  current.type === "removeCharacter"
                    ? target === "__all__"
                      ? { ...current, all: true, characterId: null }
                      : { ...current, all: false, characterId: target }
                    : current,
                )
              }
            />
          </Field>
          <CharacterTransitionFields
            transition={block.transition}
            onChange={(transition) =>
              patch((current) =>
                current.type === "removeCharacter"
                  ? { ...current, transition }
                  : current,
              )
            }
          />
        </>
      ) : block.type === "narration" ? (
        <>
          <div className="galgame-field">
            <span>旁白正文</span>
            <RichTextEditor
              ariaLabel="旁白正文"
              value={block.content ?? plainRichText(block.text)}
              document={document}
              placeholder="写下旁白…"
              onChange={(content) =>
                patch((current) =>
                  current.type === "narration"
                    ? { ...current, content, text: richTextPlainText(content) }
                    : current,
                )
              }
            />
          </div>
          <label className="galgame-stage-checkbox">
            <input
              type="checkbox"
              checked={block.hideDialogueAfter ?? false}
              onChange={(event) =>
                patch((current) =>
                  current.type === "narration"
                    ? { ...current, hideDialogueAfter: event.target.checked }
                    : current,
                )
              }
            />
            <span>本句后隐藏对话框（┘）</span>
          </label>
        </>
      ) : block.type === "dialogue" ? (
        <>
          <Field label="说话角色">
            <CustomSelect
              ariaLabel="说话角色"
              value={block.characterId}
              options={(document.characters ?? []).map((character) => ({
                value: character.id,
                label: character.name,
              }))}
              onChange={(characterId) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? withDialogueSpeakers(
                        current,
                        (() => {
                          const currentSpeakers = dialogueSpeakerIds(current);
                          if (currentSpeakers.length === 1)
                            return [characterId];
                          if (currentSpeakers.includes(characterId))
                            return [
                              characterId,
                              ...currentSpeakers.filter(
                                (speakerId) => speakerId !== characterId,
                              ),
                            ];
                          return [characterId, ...currentSpeakers.slice(1)];
                        })(),
                      )
                    : current,
                )
              }
            />
            <div
              className="galgame-dialogue-speakers"
              role="group"
              aria-label="同时说话角色"
            >
              {(document.characters ?? []).map((character) => {
                const speakerIds = dialogueSpeakerIds(block);
                const primary = character.id === block.characterId;
                return (
                  <label key={character.id}>
                    <input
                      type="checkbox"
                      checked={speakerIds.includes(character.id)}
                      disabled={primary}
                      onChange={(event) =>
                        patch((current) => {
                          if (current.type !== "dialogue") return current;
                          const currentSpeakers = dialogueSpeakerIds(current);
                          return withDialogueSpeakers(
                            current,
                            event.target.checked
                              ? [...currentSpeakers, character.id]
                              : currentSpeakers.filter(
                                  (speakerId) => speakerId !== character.id,
                                ),
                          );
                        })
                      }
                    />
                    <span>{character.name}</span>
                    {primary ? <small>主角色</small> : null}
                  </label>
                );
              })}
            </div>
            <small className="galgame-field-hint">
              可勾选多人同时说这一句；主角色继续控制本句表情、立绘和配音绑定。
            </small>
          </Field>
          <Field label="对白表情">
            <CustomSelect
              ariaLabel="对白表情"
              value={block.expressionId ?? ""}
              options={(() => {
                const character = (document.characters ?? []).find(
                  (candidate) => candidate.id === block.characterId,
                );
                const defaultExpression = (character?.expressions ?? []).find(
                  (expression) =>
                    expression.id === character?.defaultExpressionId,
                );
                return [
                  {
                    value: "",
                    label: `跟随默认${defaultExpression ? ` · ${defaultExpression.label}` : ""}`,
                  },
                  ...(character?.expressions ?? []).map((expression) => ({
                    value: expression.id,
                    label: expression.label,
                  })),
                ];
              })()}
              onChange={(expressionId) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? {
                        ...current,
                        expressionId: expressionId || null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="显示名方案">
            <CustomSelect
              ariaLabel="对白显示名方案"
              value={block.displayNameId ?? ""}
              options={(() => {
                const character = (document.characters ?? []).find(
                  (candidate) => candidate.id === block.characterId,
                );
                return [
                  {
                    value: "",
                    label: `角色本名 · ${character?.name ?? "未知角色"}`,
                  },
                  ...(character?.displayNames ?? []).map((item) => ({
                    value: item.id,
                    label: `${item.label}${item.source === "variable" ? " · 变量" : ""}`,
                  })),
                ];
              })()}
              onChange={(displayNameId) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? { ...current, displayNameId: displayNameId || null }
                    : current,
                )
              }
            />
          </Field>
          <div className="galgame-field">
            <span>对白正文</span>
            <RichTextEditor
              ariaLabel="对白正文"
              value={block.content ?? plainRichText(block.text)}
              document={document}
              character={(document.characters ?? []).find(
                (candidate) => candidate.id === block.characterId,
              )}
              placeholder="写下对白…"
              onPlainTextChange={() => block.voiceAssetId && onVoiceStale()}
              onChange={(content) => {
                patch((current) =>
                  current.type === "dialogue"
                    ? { ...current, content, text: richTextPlainText(content) }
                    : current,
                );
              }}
            />
          </div>
          <Field label="立绘演出">
            <CustomSelect
              ariaLabel="对白立绘模式"
              value={block.portrait?.mode ?? "legacy"}
              options={[
                ...(!block.portrait
                  ? [
                      {
                        value: "legacy",
                        label: "旧版临时立绘（兼容）",
                      },
                    ]
                  : []),
                { value: "stage", label: "舞台立绘" },
                { value: "dialogueAvatar", label: "仅对白头像" },
                { value: "soloLegacy", label: "旧版单人特写（兼容）" },
              ]}
              onChange={(mode) =>
                patch((current) => {
                  if (current.type !== "dialogue") return current;
                  if (mode === "legacy") return { ...current, portrait: null };
                  return {
                    ...current,
                    portrait: {
                      mode: mode as "stage" | "dialogueAvatar" | "soloLegacy",
                      visible: true,
                      keepAfter: mode === "stage",
                      transform: null,
                      transition: DEFAULT_CHARACTER_TRANSITION,
                    },
                  };
                })
              }
            />
          </Field>
          {block.portrait ? (
            <label className="galgame-stage-checkbox">
              <input
                type="checkbox"
                checked={block.portrait.visible !== false}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "dialogue" && current.portrait
                      ? {
                          ...current,
                          portrait: {
                            ...current.portrait,
                            visible: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
              />
              <span>显示立绘或对白头像</span>
            </label>
          ) : null}
          {block.portrait ? (
            <Field label="立绘皮肤">
              <CustomSelect
                ariaLabel="对白立绘皮肤"
                value={block.portrait.skinId ?? ""}
                options={(() => {
                  const character = (document.characters ?? []).find(
                    (candidate) => candidate.id === block.characterId,
                  );
                  return [
                    { value: "", label: "自动 · 角色默认皮肤" },
                    ...(character?.portraitSkins ?? []).map((skin) => ({
                      value: skin.id,
                      label: skin.name,
                    })),
                  ];
                })()}
                onChange={(skinId) =>
                  patch((current) =>
                    current.type === "dialogue" && current.portrait
                      ? {
                          ...current,
                          portrait: {
                            ...current.portrait,
                            skinId: skinId || null,
                          },
                        }
                      : current,
                  )
                }
              />
            </Field>
          ) : null}
          {block.portrait?.mode === "stage" ? (
            <label className="galgame-stage-checkbox">
              <input
                type="checkbox"
                checked={block.portrait.keepAfter}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "dialogue" && current.portrait
                      ? {
                          ...current,
                          portrait: {
                            ...current.portrait,
                            keepAfter: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
              />
              <span>对白结束后保留角色</span>
            </label>
          ) : null}
          {block.portrait ? (
            <details className="galgame-dialogue-portrait-advanced">
              <summary>高级立绘设置</summary>
              <div>
                {block.portrait.mode === "stage" ? (
                  <label className="galgame-stage-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(block.portrait.transform)}
                      onChange={(event) =>
                        patch((current) =>
                          current.type === "dialogue" && current.portrait
                            ? {
                                ...current,
                                portrait: {
                                  ...current.portrait,
                                  transform: event.target.checked
                                    ? DEFAULT_CHARACTER_TRANSFORM
                                    : null,
                                },
                              }
                            : current,
                        )
                      }
                    />
                    <span>为这句对白自定义站位与外观</span>
                  </label>
                ) : null}
                {block.portrait.visible !== false &&
                (block.portrait.mode === "soloLegacy" ||
                  block.portrait.transform) ? (
                  <CharacterTransformFields
                    transform={block.portrait.transform}
                    transition={block.portrait.transition}
                    onTransform={(transform) =>
                      patch((current) =>
                        current.type === "dialogue" && current.portrait
                          ? {
                              ...current,
                              portrait: { ...current.portrait, transform },
                            }
                          : current,
                      )
                    }
                    onTransition={(transition) =>
                      patch((current) =>
                        current.type === "dialogue" && current.portrait
                          ? {
                              ...current,
                              portrait: { ...current.portrait, transition },
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <CharacterTransitionFields
                    transition={block.portrait.transition}
                    onChange={(transition) =>
                      patch((current) =>
                        current.type === "dialogue" && current.portrait
                          ? {
                              ...current,
                              portrait: { ...current.portrait, transition },
                            }
                          : current,
                      )
                    }
                  />
                )}
              </div>
            </details>
          ) : null}
          <label className="galgame-stage-checkbox">
            <input
              type="checkbox"
              checked={block.hideDialogueAfter ?? false}
              onChange={(event) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? { ...current, hideDialogueAfter: event.target.checked }
                    : current,
                )
              }
            />
            <span>本句后隐藏对话框（┘）</span>
          </label>
          <DialogueVoiceBinding
            projectId={projectId}
            document={document}
            fragmentId={fragmentId}
            block={block}
            stale={voiceStale}
            onDocument={onDocument}
            onFresh={onVoiceFresh}
            onNotice={onNotice}
          />
        </>
      ) : block.type === "storyParagraph" ? (
        <>
          <Field label="段落正文">
            <RichTextEditor
              ariaLabel="剧情段落正文"
              value={block.content ?? plainRichText(block.text)}
              document={document}
              placeholder="写下全屏剧情段落…"
              onChange={(content) =>
                patch((current) =>
                  current.type === "storyParagraph"
                    ? { ...current, content, text: richTextPlainText(content) }
                    : current,
                )
              }
            />
          </Field>
          <Field label="打字速度（字/秒，0 使用全局）">
            <input
              type="number"
              min="0"
              max="240"
              value={block.textSpeedCps ?? 0}
              onChange={(event) =>
                patch((current) =>
                  current.type === "storyParagraph"
                    ? { ...current, textSpeedCps: Number(event.target.value) }
                    : current,
                )
              }
            />
          </Field>
          <p className="galgame-inspector-note">
            相邻段落会合并为一次全屏演出，并使用组内第一段的打字速度。
          </p>
        </>
      ) : block.type === "paragraphParams" ? (
        <>
          <Field label="文字速度">
            <input
              type="number"
              min="0"
              max="240"
              value={block.textSpeedCps ?? ""}
              placeholder="不修改"
              onChange={(event) =>
                patch((current) =>
                  current.type === "paragraphParams"
                    ? {
                        ...current,
                        textSpeedCps: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="呈现效果">
            <CustomSelect
              ariaLabel="段落呈现效果"
              value={block.revealEffect ?? ""}
              options={[
                { value: "", label: "不修改" },
                { value: "typewriter", label: "逐字显示" },
                { value: "fade", label: "淡入显示" },
                { value: "instant", label: "立即显示" },
              ]}
              onChange={(revealEffect) =>
                patch((current) =>
                  current.type === "paragraphParams"
                    ? {
                        ...current,
                        revealEffect:
                          (revealEffect as "typewriter" | "fade" | "instant") ||
                          null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="淡入时长（ms）">
            <input
              type="number"
              min="0"
              max="5000"
              value={block.fadeMs ?? ""}
              placeholder="不修改"
              onChange={(event) =>
                patch((current) =>
                  current.type === "paragraphParams"
                    ? {
                        ...current,
                        fadeMs: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="已读行为">
            <CustomSelect
              ariaLabel="段落已读行为"
              value={block.readBehavior ?? ""}
              options={[
                { value: "", label: "不修改" },
                { value: "inherit", label: "继承样式" },
                { value: "dim", label: "已读变暗" },
                { value: "keep", label: "保持原样" },
              ]}
              onChange={(readBehavior) =>
                patch((current) =>
                  current.type === "paragraphParams"
                    ? {
                        ...current,
                        readBehavior:
                          (readBehavior as "inherit" | "dim" | "keep") || null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="保留已读段落（0 不限）">
            <input
              type="number"
              min="0"
              max="100"
              value={block.historyLimit ?? ""}
              placeholder="不修改"
              onChange={(event) =>
                patch((current) =>
                  current.type === "paragraphParams"
                    ? {
                        ...current,
                        historyLimit: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="段落样式">
            <CustomSelect
              ariaLabel="后续段落样式"
              value={
                block.styleRef
                  ? `${block.styleRef.source}:${block.styleRef.id}`
                  : ""
              }
              options={[
                { value: "", label: "不修改" },
                ...["classic", "novel", "minimal", "cinema"].map((id) => ({
                  value: `builtin:${id}`,
                  label: `内置 · ${id}`,
                })),
                ...(document.presentation?.paragraph?.customStyles ?? []).map(
                  (style) => ({
                    value: `project:${style.id}`,
                    label: `项目 · ${style.name}`,
                  }),
                ),
              ]}
              onChange={(value) =>
                patch((current) => {
                  if (current.type !== "paragraphParams") return current;
                  if (!value) return { ...current, styleRef: null };
                  const [source, id] = value.split(":", 2);
                  return {
                    ...current,
                    styleRef: {
                      source: source as "builtin" | "project" | "extension",
                      id,
                    },
                  };
                })
              }
            />
          </Field>
        </>
      ) : block.type === "systemMessage" ? (
        <>
          <Field label="消息模式">
            <CustomSelect
              ariaLabel="系统消息模式"
              value={block.mode}
              options={[
                { value: "alert", label: "提示（单按钮）" },
                { value: "confirm", label: "确认 / 取消" },
              ]}
              onChange={(mode) =>
                patch((current) =>
                  current.type === "systemMessage"
                    ? {
                        ...current,
                        mode: mode as "alert" | "confirm",
                        resultVariableId:
                          mode === "alert" ? null : current.resultVariableId,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="语义颜色">
            <CustomSelect
              ariaLabel="系统消息语义颜色"
              value={block.tone}
              options={[
                { value: "info", label: "信息" },
                { value: "success", label: "成功" },
                { value: "warning", label: "警告" },
                { value: "danger", label: "危险" },
              ]}
              onChange={(tone) =>
                patch((current) =>
                  current.type === "systemMessage"
                    ? {
                        ...current,
                        tone: tone as "info" | "success" | "warning" | "danger",
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="标题">
            <input
              value={block.title ?? ""}
              placeholder={block.mode === "confirm" ? "请确认" : "提示"}
              onChange={(event) =>
                patch((current) =>
                  current.type === "systemMessage"
                    ? { ...current, title: event.target.value || null }
                    : current,
                )
              }
            />
          </Field>
          <Field label="消息正文">
            <textarea
              value={block.text}
              onChange={(event) =>
                patch((current) =>
                  current.type === "systemMessage"
                    ? { ...current, text: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          {block.mode === "confirm" ? (
            <Field label="保存结果到布尔变量">
              <CustomSelect
                ariaLabel="系统消息结果变量"
                value={block.resultVariableId ?? ""}
                options={[
                  { value: "", label: "不保存" },
                  ...(document.variables ?? [])
                    .filter((variable) => variable.type === "boolean")
                    .map((variable) => ({
                      value: variable.id,
                      label: variable.name,
                    })),
                ]}
                onChange={(resultVariableId) =>
                  patch((current) =>
                    current.type === "systemMessage"
                      ? {
                          ...current,
                          resultVariableId: resultVariableId || null,
                        }
                      : current,
                  )
                }
              />
            </Field>
          ) : null}
        </>
      ) : block.type === "wait" ? (
        <>
          <Field label="等待模式">
            <CustomSelect
              ariaLabel="等待模式"
              value={block.mode}
              options={[
                { value: "duration", label: "等待指定时间" },
                { value: "player", label: "等待玩家继续" },
              ]}
              onChange={(mode) =>
                patch((current) =>
                  current.type === "wait"
                    ? mode === "player"
                      ? { ...current, mode: "player", durationMs: null }
                      : { ...current, mode: "duration", durationMs: 1000 }
                    : current,
                )
              }
            />
          </Field>
          {block.mode === "duration" ? (
            <Field label="等待时长">
              <div className="galgame-wait-presets">
                {[200, 500, 1000, 2000, 3000].map((durationMs) => (
                  <button
                    key={durationMs}
                    type="button"
                    className={block.durationMs === durationMs ? "active" : ""}
                    onClick={() =>
                      patch((current) =>
                        current.type === "wait"
                          ? { ...current, durationMs }
                          : current,
                      )
                    }
                  >
                    {durationMs}ms
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <p className="galgame-inspector-note">
              自动播放和跳过模式都不会越过此 Block，必须由玩家继续。
            </p>
          )}
        </>
      ) : block.type === "audio" ? (
        <>
          <Field label="动作">
            <CustomSelect
              ariaLabel="声音动作"
              value={block.action}
              options={[
                { value: "play", label: "播放 / 切换" },
                { value: "stop", label: "停止通道" },
              ]}
              onChange={(action) =>
                patch((current) => {
                  if (current.type !== "audio") return current;
                  if (action === "stop")
                    return { ...current, action: "stop", assetId: null };
                  const asset = (document.assets ?? []).find(
                    (candidate) =>
                      candidate.type === "audio" &&
                      candidate.role ===
                        {
                          bgm: "backgroundMusic",
                          ambient: "ambientSound",
                          sfx: "soundEffect",
                        }[current.channel],
                  );
                  return asset
                    ? { ...current, action: "play", assetId: asset.id }
                    : current;
                })
              }
            />
          </Field>
          <Field label="声音通道">
            <CustomSelect
              ariaLabel="声音通道"
              value={block.channel}
              options={[
                { value: "bgm", label: "背景音乐" },
                { value: "ambient", label: "环境音" },
                { value: "sfx", label: "音效" },
              ]}
              onChange={(channel) =>
                patch((current) => {
                  if (current.type !== "audio") return current;
                  const nextChannel = channel as "bgm" | "ambient" | "sfx";
                  const defaults =
                    nextChannel === "sfx"
                      ? { volume: 100, loop: false, fadeMs: 0 }
                      : { volume: 70, loop: true, fadeMs: 1000 };
                  const asset = (document.assets ?? []).find(
                    (candidate) =>
                      candidate.type === "audio" &&
                      candidate.role ===
                        {
                          bgm: "backgroundMusic",
                          ambient: "ambientSound",
                          sfx: "soundEffect",
                        }[nextChannel],
                  );
                  return {
                    ...current,
                    channel: nextChannel,
                    assetId:
                      current.action === "play" ? (asset?.id ?? null) : null,
                    ...defaults,
                  };
                })
              }
            />
          </Field>
          {block.action === "play" ? (
            <Field label="声音素材">
              <CustomSelect
                ariaLabel="声音素材"
                value={block.assetId ?? ""}
                options={(document.assets ?? [])
                  .filter(
                    (asset) =>
                      asset.type === "audio" &&
                      asset.role ===
                        {
                          bgm: "backgroundMusic",
                          ambient: "ambientSound",
                          sfx: "soundEffect",
                        }[block.channel],
                  )
                  .map((asset) => ({
                    value: asset.id,
                    label: asset.type === "audio" ? asset.label : "未知声音",
                  }))}
                onChange={(assetId) =>
                  patch((current) =>
                    current.type === "audio"
                      ? { ...current, assetId }
                      : current,
                  )
                }
              />
            </Field>
          ) : null}
          <label className="galgame-audio-range">
            <span>
              {block.action === "stop" ? "淡出时间" : "播放音量"}
              <em>
                {block.action === "stop"
                  ? `${(block.fadeMs / 1000).toFixed(1)}s`
                  : `${block.volume}%`}
              </em>
            </span>
            <input
              type="range"
              min="0"
              max={block.action === "stop" ? "10000" : "100"}
              step={block.action === "stop" ? "100" : "1"}
              value={block.action === "stop" ? block.fadeMs : block.volume}
              onChange={(event) =>
                patch((current) =>
                  current.type === "audio"
                    ? block.action === "stop"
                      ? { ...current, fadeMs: Number(event.target.value) }
                      : { ...current, volume: Number(event.target.value) }
                    : current,
                )
              }
            />
          </label>
          {block.action === "play" ? (
            <>
              <label className="galgame-audio-range">
                <span>
                  淡入时间 <em>{(block.fadeMs / 1000).toFixed(1)}s</em>
                </span>
                <input
                  type="range"
                  min="0"
                  max="10000"
                  step="100"
                  value={block.fadeMs}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "audio"
                        ? { ...current, fadeMs: Number(event.target.value) }
                        : current,
                    )
                  }
                />
              </label>
              <label className="galgame-audio-loop">
                <input
                  type="checkbox"
                  checked={block.loop}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "audio"
                        ? { ...current, loop: event.target.checked }
                        : current,
                    )
                  }
                />
                <span>循环播放</span>
              </label>
            </>
          ) : null}
        </>
      ) : block.type === "video" ? (
        <>
          <Field label="视频动作">
            <CustomSelect
              ariaLabel="视频动作"
              value={block.action}
              options={[
                { value: "play", label: "播放 / 切换" },
                { value: "stop", label: "停止视频" },
              ]}
              onChange={(action) =>
                patch((current) => {
                  if (current.type !== "video") return current;
                  if (action === "stop")
                    return {
                      ...current,
                      action: "stop",
                      assetId: null,
                      waitForCompletion: false,
                    };
                  const asset = (document.assets ?? []).find(
                    (candidate) => candidate.type === "video",
                  );
                  return asset
                    ? { ...current, action: "play", assetId: asset.id }
                    : current;
                })
              }
            />
          </Field>
          {block.action === "play" ? (
            <>
              <Field label="视频素材">
                <CustomSelect
                  ariaLabel="视频素材"
                  value={block.assetId ?? ""}
                  options={(document.assets ?? [])
                    .filter((asset) => asset.type === "video")
                    .map((asset) => ({
                      value: asset.id,
                      label: asset.label,
                    }))}
                  onChange={(assetId) =>
                    patch((current) =>
                      current.type === "video"
                        ? { ...current, assetId }
                        : current,
                    )
                  }
                />
              </Field>
              <Field label="画面适配">
                <CustomSelect
                  ariaLabel="视频画面适配"
                  value={block.fit}
                  options={[
                    { value: "cover", label: "铺满裁切" },
                    { value: "contain", label: "完整显示" },
                  ]}
                  onChange={(fit) =>
                    patch((current) =>
                      current.type === "video"
                        ? { ...current, fit: fit as "cover" | "contain" }
                        : current,
                    )
                  }
                />
              </Field>
              <label className="galgame-audio-range">
                <span>
                  视频音量 <em>{block.volume}%</em>
                </span>
                <input
                  aria-label="视频音量"
                  type="range"
                  min="0"
                  max="100"
                  value={block.volume}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "video"
                        ? { ...current, volume: Number(event.target.value) }
                        : current,
                    )
                  }
                />
              </label>
              <label className="galgame-audio-loop">
                <input
                  type="checkbox"
                  checked={block.loop}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "video"
                        ? {
                            ...current,
                            loop: event.target.checked,
                            waitForCompletion: event.target.checked
                              ? false
                              : current.waitForCompletion,
                          }
                        : current,
                    )
                  }
                />
                <span>循环播放</span>
              </label>
              <label className="galgame-audio-loop">
                <input
                  type="checkbox"
                  checked={block.waitForCompletion}
                  disabled={block.loop}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "video"
                        ? {
                            ...current,
                            waitForCompletion: event.target.checked,
                          }
                        : current,
                    )
                  }
                />
                <span>播放完成后继续</span>
              </label>
            </>
          ) : null}
        </>
      ) : block.type === "branch" ? (
        <>
          <Field label="选择提示">
            <input
              value={block.prompt}
              onChange={(event) =>
                patch((current) =>
                  current.type === "branch"
                    ? { ...current, prompt: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          <div className="galgame-choice-editor">
            {block.choices.map((choice, choiceIndex) => (
              <div key={choice.id}>
                <Field label={`选项 ${choiceIndex + 1}`}>
                  <input
                    aria-label={`选项 ${choiceIndex + 1} 文案`}
                    value={choice.text}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "branch"
                          ? {
                              ...current,
                              choices: current.choices.map((item) =>
                                item.id === choice.id
                                  ? { ...item, text: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                </Field>
                <CustomSelect
                  ariaLabel={`选项 ${choiceIndex + 1} 目标`}
                  value={choice.targetFragmentId}
                  options={(chapter.fragments ?? [])
                    .filter((fragment) => fragment.id !== fragmentId)
                    .map((fragment) => ({
                      value: fragment.id,
                      label: fragment.title,
                    }))}
                  onChange={(targetFragmentId) =>
                    patch((current) =>
                      current.type === "branch"
                        ? {
                            ...current,
                            choices: current.choices.map((item) =>
                              item.id === choice.id
                                ? {
                                    ...item,
                                    targetFragmentId,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </>
      ) : block.type === "endChapter" ? (
        <Field label="结局名称">
          <input
            value={block.label}
            onChange={(event) =>
              patch((current) =>
                current.type === "endChapter"
                  ? { ...current, label: event.target.value }
                  : current,
              )
            }
          />
        </Field>
      ) : block.type === "returnToEntry" ? (
        <p className="galgame-inspector-note">
          试玩到这里会清空变量、舞台与持续媒体状态，并从入口章重新开始。
        </p>
      ) : (
        <div className="galgame-generic-block-fields">
          {Object.entries(block)
            .filter(
              ([key]) =>
                !["id", "type", "startMs", "endMs", "atMs"].includes(key),
            )
            .map(([key, value]) => (
              <Field key={key} label={key}>
                {typeof value === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(event) =>
                      patch(
                        (current) =>
                          ({
                            ...current,
                            [key]: event.target.checked,
                          }) as GalgameStoryBlock,
                      )
                    }
                  />
                ) : typeof value === "number" ? (
                  <input
                    type="number"
                    value={value}
                    onChange={(event) =>
                      patch(
                        (current) =>
                          ({
                            ...current,
                            [key]: Number(event.target.value),
                          }) as GalgameStoryBlock,
                      )
                    }
                  />
                ) : typeof value === "string" ? (
                  <input
                    value={value}
                    onChange={(event) =>
                      patch(
                        (current) =>
                          ({
                            ...current,
                            [key]: event.target.value,
                          }) as GalgameStoryBlock,
                      )
                    }
                  />
                ) : (
                  <pre>{JSON.stringify(value, null, 2)}</pre>
                )}
              </Field>
            ))}
        </div>
      )}
    </div>
  );
}

function TimelineGapInspector({
  gap,
  fragment,
  document,
  onDocument,
}: {
  gap: GalgameTimelineGap;
  fragment: GalgameStoryFragment;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const updateEdge = (edge: "start" | "end", milliseconds: number) =>
    onDocument(
      updateFragment(document, fragment.id, () =>
        setTimelineGapEdge(fragment, gap.id, edge, milliseconds),
      ),
    );
  return (
    <div className="galgame-block-inspector galgame-gap-inspector">
      <header>
        <span className="galgame-block-kind is-narration">
          <Clock3 aria-hidden />
        </span>
        <span>
          <strong>无对白区间</strong>
          <small>
            {gap.kind === "leading"
              ? "开场无对白"
              : gap.kind === "trailing"
                ? "结尾无对白"
                : "对白间歇"}
          </small>
        </span>
      </header>
      <div className="galgame-block-timing" aria-label="无对白时间范围">
        <header>
          <Clock3 aria-hidden />
          <span>
            <strong>剧情时间轴</strong>
            <small>时长 {formatTimecode(gap.endMs - gap.startMs)}</small>
          </span>
        </header>
        <div>
          <TimecodeField
            label="无对白开始时间"
            value={gap.startMs}
            disabled={!gap.previousCueId}
            onCommit={(milliseconds) => updateEdge("start", milliseconds)}
          />
          <TimecodeField
            label="无对白结束时间"
            value={gap.endMs}
            disabled={!gap.nextCueId}
            onCommit={(milliseconds) => updateEdge("end", milliseconds)}
          />
        </div>
      </div>
      <small className="galgame-gap-note">
        无对白区间不会新增 Block；剧情时钟继续推进，非循环 BGM
        结束后保持静音，舞台保留并隐藏对话框。
      </small>
    </div>
  );
}

export function GalgameWorkshopEditorPage({
  projectId,
  onOverview,
}: {
  projectId: string;
  onOverview: () => void;
}) {
  const client = useQueryClient();
  const revisionRef = useRef(0);
  const documentRef = useRef<GalgameStoryProject | undefined>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflictRef = useRef(false);
  const initialized = useRef(false);
  const playerRef = useRef<StoryPlayerHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorGridRef = useRef<HTMLDivElement>(null);
  const playheadAddMenuRef = useRef<HTMLDetailsElement>(null);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const pendingCardFocusRef = useRef<string | undefined>(undefined);
  const [workspace, setWorkspace] = useState<EditorWorkspace>("script");
  const [commandOpen, setCommandOpen] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [assetSection, setAssetSection] = useState<AssetSection>("overview");
  const [scriptView, setScriptView] = useState<ScriptView>(loadScriptView);
  const [visualSection, setVisualSection] = useState<"scenes" | "cgs">(
    "scenes",
  );
  const [focusedVisual, setFocusedVisual] = useState<{
    kind: "scene" | "cg";
    id: string;
  }>();
  const [previewMode, setPreviewMode] = useState<"edit" | "play">("edit");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewStart, setPreviewStart] = useState<{
    chapterId: string;
    fragmentId: string;
    blockIndex?: number;
  }>();
  const [scriptLayout, setScriptLayout] =
    useState<ScriptLayoutPreferences>(loadScriptLayout);
  const [playbackFollow, setPlaybackFollow] = useState<{
    chapterId: string;
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }>();
  const [timelinePreviewMs, setTimelinePreviewMs] = useState<number | null>(
    null,
  );
  const [timelinePreferences, setTimelinePreferences] =
    useState<TimelinePreferences>(loadTimelinePreferences);
  const [stageViewportPreferences, setStageViewportPreferences] = useState(
    loadStageViewportPreferences,
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [document, setDocument] = useState<GalgameStoryProject>();
  const [selectedChapterId, setSelectedChapterId] = useState("chapter-1");
  const [selectedFragmentId, setSelectedFragmentId] = useState("main");
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [selectedTimelineGapId, setSelectedTimelineGapId] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<GalgameStoryDocument>();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [staleVoiceBlocks, setStaleVoiceBlocks] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedCharacterId, setFocusedCharacterId] = useState<string>();
  const [structureQuery, setStructureQuery] = useState("");
  const [expandedChapterId, setExpandedChapterId] = useState<string>();
  const [structureDrawerOpen, setStructureDrawerOpen] = useState(false);

  useEffect(() => {
    storeTimelinePreferences(timelinePreferences);
  }, [timelinePreferences]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    localStorage.setItem(SCRIPT_VIEW_KEY, scriptView);
  }, [scriptView]);

  useEffect(() => {
    const blockId = pendingCardFocusRef.current;
    if (!blockId) return;
    const card = globalThis.document.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"]`,
    );
    if (!card) return;
    const textarea = card.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) {
      pendingCardFocusRef.current = undefined;
      textarea.focus();
      return;
    }
    card.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    requestAnimationFrame(() => {
      const editor = card.querySelector<HTMLTextAreaElement>("textarea");
      if (!editor) return;
      pendingCardFocusRef.current = undefined;
      editor.focus();
    });
  }, [document]);

  useEffect(() => {
    storeStageViewportPreferences(stageViewportPreferences);
  }, [stageViewportPreferences]);

  useEffect(() => {
    storeScriptLayout(scriptLayout);
  }, [scriptLayout]);

  useEffect(() => {
    if (!selectedBlockId || !selectedFragmentId) return;
    localStorage.setItem(
      selectedBlockKey(projectId, selectedFragmentId),
      selectedBlockId,
    );
  }, [projectId, selectedBlockId, selectedFragmentId]);

  useEffect(() => {
    if (!document) return;
    const targetChapter =
      chapterById(document, selectedChapterId) ?? entryChapter(document);
    const targetFragment = targetChapter
      ? (fragmentById(targetChapter, selectedFragmentId) ??
        targetChapter.fragments?.[0])
      : undefined;
    if (!targetFragment?.blocks?.length) return;
    if (targetFragment.blocks.some((block) => block.id === selectedBlockId))
      return;
    const remembered = localStorage.getItem(
      selectedBlockKey(projectId, targetFragment.id),
    );
    const next =
      targetFragment.blocks.find((block) => block.id === remembered)?.id ??
      targetFragment.blocks[0].id;
    setSelectedBlockId(next);
  }, [
    document,
    projectId,
    selectedBlockId,
    selectedChapterId,
    selectedFragmentId,
  ]);

  const projectQuery = useQuery({
    queryKey: PROJECT_KEY(projectId),
    queryFn: () => getGalgameWorkshopProject(projectId),
  });
  const storyQuery = useQuery({
    queryKey: STORY_KEY(projectId),
    queryFn: () => getGalgameStoryDocument(projectId),
  });
  const { refetch: refetchStory } = storyQuery;
  const reportQuery = useQuery({
    queryKey: REPORT_KEY(projectId),
    queryFn: () => getGalgameStoryReport(projectId),
  });

  useEffect(() => {
    if (!storyQuery.data) return;
    const next = completeStoryDocument(storyQuery.data.document);
    if (initialized.current) {
      if (storyQuery.data.revision <= revisionRef.current) return;
      if (saveState !== "saved" || conflictRef.current) {
        conflictRef.current = true;
        setConflict(storyQuery.data);
        setSaveState("conflict");
        setNotice(
          `服务器已有 revision ${storyQuery.data.revision}，本地改动未被覆盖。`,
        );
        return;
      }
      const nextChapter =
        chapterById(next, selectedChapterId) ?? entryChapter(next);
      const preservedFragment = nextChapter?.fragments?.find(
        (fragment) => fragment.id === selectedFragmentId,
      );
      const entryFragment = nextChapter?.fragments?.find(
        (fragment) => fragment.id === nextChapter.entryFragmentId,
      );
      const targetFragment =
        preservedFragment ?? entryFragment ?? nextChapter?.fragments?.[0];
      const preservedBlock = targetFragment?.blocks?.find(
        (block) => block.id === selectedBlockId,
      );
      revisionRef.current = storyQuery.data.revision;
      documentRef.current = next;
      setDocument(next);
      setSelectedChapterId(nextChapter?.id ?? "chapter-1");
      setSelectedFragmentId(targetFragment?.id ?? "main");
      setSelectedBlockId(selectedBlockId ? preservedBlock?.id : undefined);
      if (
        selectedTimelineGapId &&
        (!targetFragment ||
          !timelineGaps(targetFragment).some(
            (gap) => gap.id === selectedTimelineGapId,
          ))
      )
        setSelectedTimelineGapId(undefined);
      setNotice(`已载入服务器 revision ${storyQuery.data.revision}。`);
      return;
    }
    const initialChapter = entryChapter(next);
    const entry = initialChapter?.entryFragmentId ?? "main";
    initialized.current = true;
    revisionRef.current = storyQuery.data.revision;
    documentRef.current = next;
    setDocument(next);
    setSelectedChapterId(initialChapter?.id ?? "chapter-1");
    setSelectedFragmentId(entry);
    setSelectedBlockId(undefined);
  }, [
    saveState,
    selectedBlockId,
    selectedChapterId,
    selectedFragmentId,
    selectedTimelineGapId,
    storyQuery.data,
  ]);

  useEffect(() => {
    const refreshOnFocus = () => void refetchStory();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refetchStory]);

  useEffect(
    () => () => {
      if (autoSave.current) clearTimeout(autoSave.current);
      resizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "saved") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  const enqueueSave = useCallback(
    (snapshot: GalgameStoryProject) => {
      const copy = structuredClone(snapshot);
      let saved = false;
      const operation = saveQueue.current.then(async () => {
        if (conflictRef.current) return false;
        setSaveState("saving");
        setSaveMessage("");
        try {
          const updated = await putGalgameStoryDocument(
            projectId,
            copy,
            revisionRef.current,
          );
          revisionRef.current = updated.revision;
          client.setQueryData(STORY_KEY(projectId), updated);
          setSaveState("saved");
          void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
          void client.invalidateQueries({ queryKey: PROJECT_KEY(projectId) });
          void client.invalidateQueries({
            queryKey: ["galgame-workshop-projects"],
          });
          saved = true;
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              GalgameStoryDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return false;
            }
          }
          setSaveState("error");
          setSaveMessage(errorMessage(error));
          return false;
        }
      });
      saveQueue.current = operation.then(() => undefined);
      return operation.then(() => saved);
    },
    [client, projectId],
  );

  const replaceDocument = useCallback(
    (next: GalgameStoryProject) => {
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      if (autoSave.current) clearTimeout(autoSave.current);
      autoSave.current = setTimeout(
        () => enqueueSave(documentRef.current!),
        650,
      );
    },
    [enqueueSave],
  );

  const commitDocument = useCallback(
    async (next: GalgameStoryProject) => {
      if (autoSave.current) clearTimeout(autoSave.current);
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      return enqueueSave(next);
    },
    [enqueueSave],
  );
  const upgradePortraitSizes = useCallback(async () => {
    const current = documentRef.current;
    if (!current || !(await commitDocument(current))) return false;
    try {
      const updated = await applyGalgamePortraitUpgrade(
        projectId,
        revisionRef.current,
      );
      const next = completeStoryDocument(updated.document);
      revisionRef.current = updated.revision;
      documentRef.current = next;
      setDocument(next);
      client.setQueryData(STORY_KEY(projectId), updated);
      void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
      setNotice("已按素材尺寸升级立绘高度，并保存了可恢复快照。");
      return true;
    } catch (error) {
      setNotice(errorMessage(error));
      return false;
    }
  }, [client, commitDocument, projectId]);
  const repairMissingAsset = useCallback(
    async (storyAssetId: string, replacementFileId: string) => {
      const current = documentRef.current;
      if (!current || !(await commitDocument(current))) return false;
      try {
        const updated = await repairGalgameMissingAsset(
          projectId,
          revisionRef.current,
          storyAssetId,
          replacementFileId,
        );
        const next = completeStoryDocument(updated.document);
        revisionRef.current = updated.revision;
        documentRef.current = next;
        setDocument(next);
        client.setQueryData(STORY_KEY(projectId), updated);
        void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
        void client.invalidateQueries({
          queryKey: ["galgame-asset-overview", projectId],
        });
        void client.invalidateQueries({
          queryKey: ["galgame-package-manifest", projectId],
        });
        setSaveState("saved");
        setNotice("缺失素材已重新绑定并保存。");
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const currentDocument = error.problem.current as
            | GalgameStoryDocument
            | undefined;
          if (currentDocument) {
            conflictRef.current = true;
            setConflict(currentDocument);
            setSaveState("conflict");
          }
        }
        setNotice(errorMessage(error));
        return false;
      }
    },
    [client, commitDocument, projectId],
  );
  const previewTimelinePosition = useCallback((milliseconds: number | null) => {
    setTimelinePreviewMs(milliseconds);
  }, []);

  if (storyQuery.isLoading || projectQuery.isLoading || !document)
    return (
      <div className="workshop-state galgame-editor-state">
        <RefreshCcw className="spinning" aria-hidden />
        <strong>正在打开剧本编辑器</strong>
      </div>
    );
  if (storyQuery.isError || projectQuery.isError)
    return (
      <div className="workshop-state galgame-editor-state">
        <strong>剧本编辑器暂时无法打开</strong>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );

  const chapter =
    chapterById(document, selectedChapterId) ?? entryChapter(document)!;
  const fragments = chapter.fragments ?? [];
  const selectedFragment =
    fragmentById(chapter, selectedFragmentId) ?? fragments[0];
  const projectedSelectedFragment = selectedFragment
    ? projectFragmentTimeline(selectedFragment)
    : undefined;
  const playbackSourceChapter = playbackFollow
    ? chapterById(document, playbackFollow.chapterId)
    : undefined;
  const playbackSourceFragment =
    playbackFollow && playbackSourceChapter
      ? fragmentById(playbackSourceChapter, playbackFollow.fragmentId)
      : undefined;
  const timelineSourceFragment =
    previewMode === "play" && playbackSourceFragment
      ? playbackSourceFragment
      : selectedFragment;
  const timelineFragment = timelineSourceFragment
    ? projectFragmentTimeline(timelineSourceFragment)
    : undefined;
  const rememberedSelectedBlockId = selectedFragment
    ? localStorage.getItem(selectedBlockKey(projectId, selectedFragment.id))
    : undefined;
  const selectedBlock =
    selectedFragment?.blocks?.find((block) => block.id === selectedBlockId) ??
    selectedFragment?.blocks?.find(
      (block) => block.id === rememberedSelectedBlockId,
    ) ??
    selectedFragment?.blocks?.[0];
  const selectedTimelineGap = projectedSelectedFragment
    ? timelineGaps(projectedSelectedFragment).find(
        (gap) => gap.id === selectedTimelineGapId,
      )
    : undefined;
  const report = reportQuery.data;
  const savedDocument = completeStoryDocument(
    storyQuery.data?.document ?? document,
  );
  const reportRefreshing = Boolean(
    reportQuery.isFetching ||
    (report && report.story_revision !== storyQuery.data?.revision),
  );
  const reportIssueCount = report
    ? report.errors.length + report.warnings.length
    : 0;
  const selectedIndex = selectedFragment?.blocks?.findIndex(
    (block) => block.id === selectedBlock?.id,
  );
  const lastBlock = selectedFragment?.blocks?.at(-1);
  const terminates = lastBlock ? isTerminator(lastBlock) : false;
  const editableCharacterId =
    selectedBlock?.type === "showCharacter" ||
    (selectedBlock?.type === "dialogue" &&
      selectedBlock.portrait &&
      selectedBlock.portrait.mode === "stage" &&
      selectedBlock.portrait.visible !== false)
      ? selectedBlock.characterId
      : undefined;
  const editableCgBlockId =
    selectedBlock?.type === "showCg" &&
    (selectedBlock.displayMode ?? "fullscreen") === "overlay"
      ? selectedBlock.id
      : undefined;

  const selectFragment = (fragment: GalgameStoryFragment) => {
    setSelectedFragmentId(fragment.id);
    setSelectedTimelineGapId(undefined);
    setSelectedBlockId(undefined);
    setTimelinePreviewMs(null);
    setStructureDrawerOpen(false);
  };
  const selectChapter = (nextChapter: GalgameStoryChapter) => {
    const fragment =
      nextChapter.fragments?.find(
        (item) => item.id === nextChapter.entryFragmentId,
      ) ?? nextChapter.fragments?.[0];
    setSelectedChapterId(nextChapter.id);
    setSelectedFragmentId(fragment?.id ?? "main");
    setSelectedBlockId(undefined);
    setSelectedTimelineGapId(undefined);
    setTimelinePreviewMs(null);
    setStructureDrawerOpen(false);
  };
  const addChapter = () => {
    const id = stableId();
    const fragmentId = stableId();
    const nextChapter: GalgameStoryChapter = {
      id,
      title: `第 ${(document.chapters?.length ?? 0) + 1} 章`,
      order:
        Math.max(0, ...(document.chapters ?? []).map((item) => item.order)) + 1,
      entryFragmentId: fragmentId,
      disabled: false,
      fragments: [{ id: fragmentId, title: "开始", blocks: [] }],
    };
    replaceDocument({
      ...document,
      chapters: [...(document.chapters ?? []), nextChapter],
    });
    selectChapter(nextChapter);
  };
  const deleteChapter = (target: GalgameStoryChapter) => {
    if (target.id === document.entryChapterId) {
      setNotice("入口章节不能删除，请先设置其他入口章。");
      return;
    }
    if ((document.chapters?.length ?? 0) <= 1) {
      setNotice("工程至少需要保留一个章节。");
      return;
    }
    const fragmentIds = new Set(
      (target.fragments ?? []).map((fragment) => fragment.id),
    );
    const externalReferences = (document.chapters ?? [])
      .filter((item) => item.id !== target.id)
      .flatMap((item) => item.fragments ?? [])
      .flatMap((fragment) =>
        (fragment.blocks ?? []).flatMap((block) => {
          if (
            block.type === "branch" &&
            block.choices.some((choice) =>
              fragmentIds.has(choice.targetFragmentId),
            )
          )
            return [`Fragment“${fragment.title}”的分支`];
          if (
            block.type === "callFragment" &&
            fragmentIds.has(block.targetFragmentId)
          )
            return [`Fragment“${fragment.title}”的调用`];
          if (
            block.type === "if" &&
            (fragmentIds.has(block.thenFragmentId) ||
              (block.elseFragmentId && fragmentIds.has(block.elseFragmentId)))
          )
            return [`Fragment“${fragment.title}”的条件`];
          return [];
        }),
      );
    if (externalReferences.length) {
      setNotice(`无法删除：${[...new Set(externalReferences)].join("、")}`);
      return;
    }
    const remaining = (document.chapters ?? [])
      .filter((item) => item.id !== target.id)
      .map((item, index) => ({ ...item, order: index + 1 }));
    replaceDocument({ ...document, chapters: remaining });
    selectChapter(remaining[0]);
  };
  const moveChapter = (target: GalgameStoryChapter, direction: -1 | 1) => {
    const chapters = [...(document.chapters ?? [])].sort(
      (left, right) => left.order - right.order,
    );
    const index = chapters.findIndex((item) => item.id === target.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= chapters.length) return;
    [chapters[index], chapters[destination]] = [
      chapters[destination],
      chapters[index],
    ];
    replaceDocument({
      ...document,
      chapters: chapters.map((item, itemIndex) => ({
        ...item,
        order: itemIndex + 1,
      })),
    });
  };
  const duplicateChapter = (target: GalgameStoryChapter) => {
    const fragmentIds = new Map(
      (target.fragments ?? []).map((fragment) => [fragment.id, stableId()]),
    );
    const remapBlock = (block: GalgameStoryBlock): GalgameStoryBlock => {
      const next = { ...structuredClone(block), id: stableId() };
      if (next.type === "branch")
        return {
          ...next,
          choices: next.choices.map((choice) => ({
            ...choice,
            targetFragmentId:
              fragmentIds.get(choice.targetFragmentId) ??
              choice.targetFragmentId,
          })),
        };
      if (next.type === "callFragment")
        return {
          ...next,
          targetFragmentId:
            fragmentIds.get(next.targetFragmentId) ?? next.targetFragmentId,
        };
      if (next.type === "if")
        return {
          ...next,
          thenFragmentId:
            fragmentIds.get(next.thenFragmentId) ?? next.thenFragmentId,
          elseFragmentId: next.elseFragmentId
            ? (fragmentIds.get(next.elseFragmentId) ?? next.elseFragmentId)
            : null,
        };
      return next;
    };
    const nextChapter: GalgameStoryChapter = {
      ...structuredClone(target),
      id: stableId(),
      title: `${target.title} 副本`,
      order: (document.chapters?.length ?? 0) + 1,
      disabled: false,
      entryFragmentId:
        fragmentIds.get(target.entryFragmentId) ?? target.entryFragmentId,
      fragments: (target.fragments ?? []).map((fragment) => ({
        ...structuredClone(fragment),
        id: fragmentIds.get(fragment.id)!,
        blocks: (fragment.blocks ?? []).map(remapBlock),
      })),
    };
    replaceDocument({
      ...document,
      chapters: [...(document.chapters ?? []), nextChapter],
    });
    selectChapter(nextChapter);
  };
  const addFragment = () => {
    const id = stableId();
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: [
          ...(current.fragments ?? []),
          {
            id,
            title: `Fragment ${(current.fragments?.length ?? 0) + 1}`,
            blocks: [],
          },
        ],
      })),
    );
    setSelectedFragmentId(id);
    setSelectedTimelineGapId(undefined);
    setSelectedBlockId(undefined);
  };
  const deleteFragment = (fragment: GalgameStoryFragment) => {
    const references = referencedBy(document, "fragment", fragment.id);
    if (references.length) {
      setNotice(`无法删除：${references.join("、")}`);
      return;
    }
    if (fragments.length <= 1) {
      setNotice("章节至少需要保留一个 Fragment。");
      return;
    }
    const remaining = fragments.filter((item) => item.id !== fragment.id);
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: remaining,
      })),
    );
    selectFragment(remaining[0]);
  };
  const duplicateFragment = (fragment: GalgameStoryFragment) => {
    const nextId = stableId();
    const nextFragment: GalgameStoryFragment = {
      ...structuredClone(fragment),
      id: nextId,
      title: `${fragment.title} 副本`,
      blocks: (fragment.blocks ?? []).map((block) => {
        const next = { ...structuredClone(block), id: stableId() };
        if (next.type === "branch")
          return {
            ...next,
            choices: next.choices.map((choice) => ({
              ...choice,
              targetFragmentId:
                choice.targetFragmentId === fragment.id
                  ? nextId
                  : choice.targetFragmentId,
            })),
          };
        if (next.type === "callFragment")
          return {
            ...next,
            targetFragmentId:
              next.targetFragmentId === fragment.id
                ? nextId
                : next.targetFragmentId,
          };
        if (next.type === "if")
          return {
            ...next,
            thenFragmentId:
              next.thenFragmentId === fragment.id
                ? nextId
                : next.thenFragmentId,
            elseFragmentId:
              next.elseFragmentId === fragment.id
                ? nextId
                : next.elseFragmentId,
          };
        return next;
      }),
    };
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: [...(current.fragments ?? []), nextFragment],
      })),
    );
    selectFragment(nextFragment);
  };
  const moveFragment = (fragment: GalgameStoryFragment, direction: -1 | 1) => {
    const items = [...fragments];
    const index = items.findIndex((item) => item.id === fragment.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= items.length) return;
    [items[index], items[destination]] = [items[destination], items[index]];
    replaceDocument(
      updateChapter(document, chapter.id, (current) => ({
        ...current,
        fragments: items,
      })),
    );
  };
  const insertPreparedBlock = (
    block: GalgameStoryBlock,
    beforeBundleId?: string,
  ) => {
    if (!selectedFragment) return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) =>
        scriptView !== "performance"
          ? insertStoryBlock(fragment, block, beforeBundleId)
          : appendBlockToTimeline(
              projectFragmentTimeline(fragment),
              block,
              timelinePreviewMs ?? 0,
            ),
      ),
    );
    setSelectedBlockId(block.id);
    setSelectedTimelineGapId(undefined);
    setInspectorTab("properties");
  };
  const addBlock = (kind: BlockKind, beforeBundleId?: string) => {
    if (!selectedFragment) return;
    const block = makeBlock(kind, document, chapter, selectedFragment);
    if (!block) {
      if (kind === "showCg") {
        setNotice("请先在画面工作区创建 CG 并绑定默认差分。");
        setFocusedVisual(undefined);
        setVisualSection("cgs");
        setAssetSection("scenes");
        setWorkspace("assets");
        return;
      }
      setNotice(
        kind === "branch"
          ? "分支需要先准备至少两个其他 Fragment。"
          : kind === "dialogue" ||
              kind === "showCharacter" ||
              kind === "removeCharacter"
            ? "请先创建角色。"
            : "请先创建场景。",
      );
      return;
    }
    if (block.type === "dialogue" || block.type === "narration")
      pendingCardFocusRef.current = block.id;
    insertPreparedBlock(block, beforeBundleId);
  };
  const addAllCharactersBlock = (beforeBundleId?: string) => {
    if (!selectedFragment) return;
    const block: GalgameStoryBlock = {
      id: stableId(),
      type: "removeCharacter",
      characterId: null,
      all: true,
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
    insertPreparedBlock(block, beforeBundleId);
  };
  const addAudioBlock = (
    action: "play" | "stop",
    channel: "bgm" | "ambient" | "sfx",
    beforeBundleId?: string,
  ) => {
    if (!selectedFragment) return;
    const block = makeAudioBlock(document, action, channel);
    if (!block) {
      setNotice(
        `请先在声音工作区添加${
          { bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[channel]
        }素材。`,
      );
      setAssetSection(channel === "bgm" ? "bgm" : "sfx");
      setWorkspace("assets");
      return;
    }
    insertPreparedBlock(block, beforeBundleId);
  };
  const moveSelected = (direction: -1 | 1, requestedBlockId?: string) => {
    const blockId = requestedBlockId ?? selectedBlockId;
    if (!selectedFragment || !blockId) return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => {
        if (scriptView !== "performance")
          return moveStoryBlockBundle(fragment, blockId, direction);
        const blocks = fragment.blocks ?? [];
        const index = blocks.findIndex((block) => block.id === blockId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= blocks.length) return fragment;
        const reordered = [...blocks];
        [reordered[index], reordered[target]] = [
          reordered[target],
          reordered[index],
        ];
        return { ...fragment, blocks: reordered };
      }),
    );
  };
  const deleteSelected = (requestedBlockId?: string) => {
    const blockId = requestedBlockId ?? selectedBlockId;
    if (!selectedFragment || !blockId) return;
    const blocks = selectedFragment.blocks ?? [];
    const index = blocks.findIndex((block) => block.id === blockId);
    const bundleIndex = storyBlockBundles(selectedFragment).findIndex(
      (bundle) => bundle.blocks.some((block) => block.id === blockId),
    );
    const nextFragment =
      scriptView !== "performance"
        ? deleteStoryBlockBundle(selectedFragment, blockId)
        : {
            ...selectedFragment,
            blocks: blocks.filter((block) => block.id !== blockId),
          };
    replaceDocument(
      updateFragment(document, selectedFragment.id, () => nextFragment),
    );
    const nextBundles = storyBlockBundles(nextFragment);
    const nextSelection =
      scriptView !== "performance"
        ? nextBundles[
            Math.min(Math.max(0, bundleIndex), nextBundles.length - 1)
          ]?.primaryBlock.id
        : nextFragment.blocks?.[Math.min(index, nextFragment.blocks.length - 1)]
            ?.id;
    setSelectedBlockId(nextSelection);
    setSelectedTimelineGapId(undefined);
  };
  const locateIssue = (issue: GalgameStoryReportIssue) => {
    const issueChapter = issue.chapter_id
      ? chapterById(document, issue.chapter_id)
      : undefined;
    if (issueChapter) {
      selectChapter(issueChapter);
      setExpandedChapterId(issueChapter.id);
    }
    if (issue.fragment_id) {
      const fragment = fragmentById(issueChapter ?? chapter, issue.fragment_id);
      if (fragment) selectFragment(fragment);
    }
    if (issue.block_id) {
      setSelectedTimelineGapId(undefined);
      setSelectedBlockId(issue.block_id);
    }
    setWorkspace("script");
    setInspectorTab(issue.block_id ? "properties" : "report");
  };
  const locateRoute = (route: StoryRoute) => {
    const routeChapter = document.chapters?.find(
      (candidate) => candidate.id === route.chapterId,
    );
    const fragment = routeChapter?.fragments?.find(
      (candidate) => candidate.id === route.sourceId,
    );
    if (fragment) {
      setSelectedChapterId(routeChapter?.id ?? chapter.id);
      setExpandedChapterId(routeChapter?.id ?? chapter.id);
      setSelectedFragmentId(fragment.id);
      setSelectedTimelineGapId(undefined);
      setSelectedBlockId(route.blockId);
    }
    setWorkspace("script");
    setInspectorTab("properties");
  };
  const startPreview = (scope: "project" | "chapter" | "block" = "project") => {
    const cursor =
      scope === "project"
        ? undefined
        : scope === "chapter"
          ? {
              chapterId: chapter.id,
              fragmentId: chapter.entryFragmentId,
            }
          : selectedFragment
            ? {
                chapterId: chapter.id,
                fragmentId: selectedFragment.id,
                blockIndex: Math.max(0, selectedIndex ?? 0),
              }
            : undefined;
    setPreviewStart(cursor);
    setWorkspace("script");
    setPreviewMode("play");
    requestAnimationFrame(() => {
      playerRef.current?.restart();
      previewRef.current?.focus();
    });
  };

  const locateSearchTarget = (target: StorySearchTarget) => {
    if (target.kind === "story") {
      const targetChapter = chapterById(document, target.chapterId);
      const targetFragment = targetChapter
        ? fragmentById(targetChapter, target.fragmentId)
        : undefined;
      if (targetChapter) setSelectedChapterId(targetChapter.id);
      if (targetChapter) setExpandedChapterId(targetChapter.id);
      if (targetFragment) setSelectedFragmentId(targetFragment.id);
      setSelectedBlockId(target.blockId ?? targetFragment?.blocks?.[0]?.id);
      setSelectedTimelineGapId(undefined);
      setWorkspace("script");
      return;
    }
    setWorkspace("assets");
    if (target.kind === "character") {
      setFocusedCharacterId(target.characterId);
      setAssetSection("characters");
    } else if (target.kind === "scene") {
      setAssetSection("scenes");
      setVisualSection("scenes");
      setFocusedVisual({ kind: "scene", id: target.sceneId });
    } else if (target.kind === "cg") {
      setAssetSection("scenes");
      setVisualSection("cgs");
      setFocusedVisual({ kind: "cg", id: target.cgId });
    } else {
      setAssetSection("overview");
    }
  };

  const updateProjectTitle = async (title: string) => {
    if (!projectQuery.data) return;
    setTitleSaving(true);
    try {
      const updated = await patchGalgameWorkshopProject(projectQuery.data, {
        title,
      });
      client.setQueryData(PROJECT_KEY(projectId), updated);
      void client.invalidateQueries({
        queryKey: ["galgame-workshop-projects"],
      });
      setNotice("项目名称已保存。");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setTitleSaving(false);
    }
  };

  const startStageResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      stageViewportPreferences.collapsed ||
      event.button !== 0 ||
      window.innerWidth <= 980
    ) {
      return;
    }
    event.preventDefault();
    resizeCleanupRef.current?.();
    const move = (pointer: PointerEvent) => {
      const grid = editorGridRef.current;
      const bounds = grid?.getBoundingClientRect();
      if (!grid || !bounds) return;
      setScriptLayout((current) =>
        normalizeScriptLayout({
          ...current,
          previewSplitRatio:
            Math.round(
              clamp(
                ((pointer.clientY - bounds.top) / bounds.height) * 100,
                42,
                72,
              ) * 100,
            ) / 100,
        }),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const setStageCollapsed = (collapsed: boolean) => {
    setStageViewportPreferences((current) => ({ ...current, collapsed }));
  };

  const startSidebarResize = (
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    globalThis.document.body.classList.add("galgame-sidebar-resizing");

    const move = (pointer: PointerEvent) => {
      const bounds = editorGridRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const available = Math.max(1, bounds.width - 12);
      const pointerRatio =
        ((pointer.clientX - bounds.left - (side === "right" ? 6 : 0)) /
          available) *
        100;
      setScriptLayout((current) =>
        normalizeScriptLayout(
          side === "left"
            ? { ...current, leftRatio: pointerRatio }
            : {
                ...current,
                centerRatio: pointerRatio - current.leftRatio,
              },
        ),
      );
    };
    const finish = () => {
      globalThis.document.body.classList.remove("galgame-sidebar-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizeSidebarWithKeyboard = (
    side: "left" | "right",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 0.5 : -0.5;
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: current.leftRatio + delta }
          : { ...current, centerRatio: current.centerRatio + delta },
      ),
    );
  };

  const resetSidebarWidth = (side: "left" | "right") =>
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: DEFAULT_SCRIPT_LAYOUT.leftRatio }
          : { ...current, centerRatio: DEFAULT_SCRIPT_LAYOUT.centerRatio },
      ),
    );

  const editorGridStyle = {
    "--galgame-script-left-ratio": scriptLayout.leftRatio,
    "--galgame-script-center-ratio": scriptLayout.centerRatio,
    "--galgame-stage-split": `${scriptLayout.previewSplitRatio}%`,
  } as CSSProperties;

  return (
    <section className="galgame-editor-page">
      <header className="galgame-editor-header">
        <div className="galgame-editor-project">
          <button
            type="button"
            className="galgame-editor-back"
            aria-label="返回工程概览"
            onClick={onOverview}
          >
            <ArrowLeft aria-hidden />
          </button>
          <img
            src="/brand/galgame-workshop-mark-cutout.png"
            alt=""
            aria-hidden
          />
          <span>
            <strong>{projectQuery.data?.title}</strong>
            <small>Galgame Workshop · Story V2</small>
          </span>
        </div>
        <button
          type="button"
          className="galgame-global-search"
          onClick={() => setCommandOpen(true)}
        >
          <Search aria-hidden />
          <span>搜索台词、指令、资源…</span>
          <kbd>{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <div className="galgame-editor-actions">
          <ThemeToggle compact />
          <button
            type="button"
            className="galgame-editor-refresh"
            aria-label="刷新服务器剧本版本"
            title="刷新服务器剧本版本"
            onClick={() => void refetchStory()}
          >
            <RefreshCcw aria-hidden />
          </button>
          <div className={`galgame-save-state ${saveState}`} aria-live="polite">
            <Save aria-hidden />
            {saveState === "saved"
              ? "已保存"
              : saveState === "saving"
                ? "保存中"
                : saveState === "conflict"
                  ? "存在冲突"
                  : "保存失败"}
          </div>
          <details className="galgame-run-menu">
            <summary
              className="galgame-preview-launch"
              role="button"
              aria-label="开始试玩"
              onClick={() => startPreview("project")}
            >
              <Play aria-hidden /> 运行 <ChevronDown aria-hidden />
            </summary>
            <div>
              <button type="button" onClick={() => startPreview("project")}>
                从项目入口开始
              </button>
              <button type="button" onClick={() => startPreview("chapter")}>
                从当前章节开始
              </button>
              <button
                type="button"
                disabled={!selectedBlock}
                onClick={() => startPreview("block")}
              >
                从当前 Block 开始
              </button>
            </div>
          </details>
        </div>
      </header>
      <nav className="galgame-editor-tabs" aria-label="创作工作区">
        {WORKSPACES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={workspace === item.id ? "active" : ""}
              onClick={() => setWorkspace(item.id)}
            >
              <Icon aria-hidden /> {item.label}
            </button>
          );
        })}
      </nav>

      {notice ? (
        <div className="galgame-inline-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      ) : null}
      {saveMessage ? (
        <div className="galgame-inline-notice danger" role="alert">
          {saveMessage}
        </div>
      ) : null}

      {workspace === "script" ? (
        <div
          ref={editorGridRef}
          className="galgame-editor-grid galgame-script-workbench"
          data-stage-collapsed={
            stageViewportPreferences.collapsed ? "true" : "false"
          }
          style={editorGridStyle}
        >
          <aside
            className={`galgame-fragment-panel${structureDrawerOpen ? " is-drawer-open" : ""}`}
          >
            <div className="galgame-panel-heading">
              <span>
                <small>剧本结构</small>
              </span>
              <button type="button" aria-label="新建章节" onClick={addChapter}>
                <Plus aria-hidden /> 章节
              </button>
            </div>
            <label className="galgame-structure-search-field">
              <Search aria-hidden />
              <input
                className="galgame-structure-search"
                aria-label="搜索章节或 Fragment"
                placeholder="搜索章节 / 片段"
                value={structureQuery}
                onChange={(event) => setStructureQuery(event.target.value)}
              />
            </label>
            {entryChapter(document) ? (
              <button
                type="button"
                className="galgame-entry-fragment"
                onClick={() => selectChapter(entryChapter(document)!)}
              >
                <Play aria-hidden />
                <strong>开始</strong>
              </button>
            ) : null}
            <details className="galgame-story-settings">
              <summary>
                <Settings2 aria-hidden /> 故事设置 <ChevronDown aria-hidden />
              </summary>
              <Field label="故事简介">
                <textarea
                  value={document.synopsis}
                  placeholder="用几句话说明故事核心…"
                  onChange={(event) =>
                    replaceDocument({
                      ...document,
                      synopsis: event.target.value,
                    })
                  }
                />
              </Field>
              <div className="galgame-story-variables">
                <span>项目变量</span>
                {(document.variables ?? []).map((variable) => (
                  <div key={variable.id}>
                    <input
                      aria-label={`${variable.name}名称`}
                      value={variable.name}
                      onChange={(event) =>
                        replaceDocument({
                          ...document,
                          variables: (document.variables ?? []).map((item) =>
                            item.id === variable.id
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <code>{variable.type}</code>
                    <button
                      type="button"
                      aria-label={`删除变量 ${variable.name}`}
                      disabled={
                        referencedBy(document, "variable", variable.id).length >
                        0
                      }
                      onClick={() =>
                        replaceDocument({
                          ...document,
                          variables: (document.variables ?? []).filter(
                            (item) => item.id !== variable.id,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    replaceDocument({
                      ...document,
                      variables: [
                        ...(document.variables ?? []),
                        {
                          id: stableId(),
                          name: `变量 ${(document.variables?.length ?? 0) + 1}`,
                          type: "boolean",
                          defaultValue: false,
                          persistence: "session",
                          description: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden /> 添加变量
                </button>
              </div>
              <Field label="章节名称">
                <input
                  value={chapter.title}
                  onChange={(event) =>
                    replaceDocument(
                      updateChapter(document, chapter.id, (current) => ({
                        ...current,
                        title: event.target.value,
                      })),
                    )
                  }
                />
              </Field>
            </details>
            <div className="galgame-chapter-tree">
              {[...(document.chapters ?? [])]
                .sort((left, right) => left.order - right.order)
                .filter(
                  (item) =>
                    !structureQuery.trim() ||
                    item.title.includes(structureQuery.trim()) ||
                    item.fragments?.some((fragment) =>
                      fragment.title.includes(structureQuery.trim()),
                    ),
                )
                .map((item, chapterIndex) => {
                  const branchCount = (item.fragments ?? []).reduce(
                    (total, fragment) =>
                      total +
                      (fragment.blocks ?? []).filter(
                        (block) => block.type === "branch",
                      ).length,
                    0,
                  );
                  const expanded = expandedChapterId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={item.id === chapter.id ? "active" : ""}
                    >
                      <div className="galgame-chapter-row">
                        <button
                          type="button"
                          className="galgame-chapter-main"
                          onClick={() => selectChapter(item)}
                        >
                          <span className="galgame-chapter-number">
                            {String(chapterIndex + 1).padStart(2, "0")}
                          </span>
                          <span className="galgame-chapter-copy">
                            <span>
                              <strong>{item.title}</strong>
                              {document.entryChapterId === item.id ? (
                                <i>入口章</i>
                              ) : null}
                              {item.disabled ? <i>已禁用</i> : null}
                            </span>
                            <small>
                              <ChapterCast document={document} chapter={item} />
                              {branchCount > 0 ? (
                                <em>
                                  <GitBranch aria-hidden /> {branchCount}
                                </em>
                              ) : null}
                              {item.fragments?.length ?? 0} 片段
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="galgame-chapter-expand"
                          aria-label={`${expanded ? "收起" : "展开"}${item.title}片段`}
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedChapterId(expanded ? undefined : item.id)
                          }
                        >
                          <ChevronDown aria-hidden />
                        </button>
                      </div>
                      {expanded ? (
                        <div className="galgame-fragment-list">
                          {(item.fragments ?? [])
                            .filter(
                              (fragment) =>
                                !structureQuery.trim() ||
                                fragment.title.includes(structureQuery.trim()),
                            )
                            .map((fragment) => (
                              <button
                                key={fragment.id}
                                type="button"
                                className={
                                  selectedFragment?.id === fragment.id
                                    ? "active"
                                    : ""
                                }
                                onClick={() => selectFragment(fragment)}
                              >
                                <span>
                                  <GitBranch aria-hidden />
                                  <strong>{fragment.title}</strong>
                                </span>
                                <span>
                                  {item.entryFragmentId === fragment.id ? (
                                    <em>入口</em>
                                  ) : null}
                                  <small>{fragment.blocks?.length ?? 0}</small>
                                </span>
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </div>
            <div className="galgame-structure-actions">
              <button type="button" onClick={addFragment}>
                <Plus aria-hidden /> Fragment
              </button>
              <details className="galgame-structure-actions-menu">
                <summary aria-label="章节与片段操作">
                  <MoreHorizontal aria-hidden />
                </summary>
                <div>
                  <button
                    type="button"
                    aria-label="章节上移"
                    disabled={chapter.order <= 1}
                    onClick={() => moveChapter(chapter, -1)}
                  >
                    <ArrowUp aria-hidden /> 章节上移
                  </button>
                  <button
                    type="button"
                    aria-label="章节下移"
                    disabled={
                      chapter.order >=
                      Math.max(1, document.chapters?.length ?? 1)
                    }
                    onClick={() => moveChapter(chapter, 1)}
                  >
                    <ArrowDown aria-hidden /> 章节下移
                  </button>
                  <button
                    type="button"
                    aria-label="复制章节"
                    onClick={() => duplicateChapter(chapter)}
                  >
                    <Copy aria-hidden /> 复制章节
                  </button>
                  <button
                    type="button"
                    disabled={document.entryChapterId === chapter.id}
                    onClick={() =>
                      replaceDocument(
                        updateChapter(
                          { ...document, entryChapterId: chapter.id },
                          chapter.id,
                          (current) => ({ ...current, disabled: false }),
                        ),
                      )
                    }
                  >
                    设为入口章
                  </button>
                  <button
                    type="button"
                    disabled={document.entryChapterId === chapter.id}
                    onClick={() =>
                      replaceDocument(
                        updateChapter(document, chapter.id, (current) => ({
                          ...current,
                          disabled: !current.disabled,
                        })),
                      )
                    }
                  >
                    {chapter.disabled ? "启用" : "禁用"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => deleteChapter(chapter)}
                  >
                    删除章
                  </button>
                </div>
              </details>
            </div>
            {selectedFragment ? (
              <details className="galgame-fragment-actions">
                <summary>当前片段 · {selectedFragment.title}</summary>
                <div>
                  <input
                    aria-label="结构树 Fragment 名称"
                    value={selectedFragment.title}
                    onChange={(event) =>
                      replaceDocument(
                        updateFragment(
                          document,
                          selectedFragment.id,
                          (current) => ({
                            ...current,
                            title: event.target.value,
                          }),
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Fragment 上移"
                    disabled={fragments[0]?.id === selectedFragment.id}
                    onClick={() => moveFragment(selectedFragment, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Fragment 下移"
                    disabled={fragments.at(-1)?.id === selectedFragment.id}
                    onClick={() => moveFragment(selectedFragment, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="复制 Fragment"
                    onClick={() => duplicateFragment(selectedFragment)}
                  >
                    <Copy aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={chapter.entryFragmentId === selectedFragment.id}
                    onClick={() =>
                      replaceDocument(
                        updateChapter(document, chapter.id, (current) => ({
                          ...current,
                          entryFragmentId: selectedFragment.id,
                        })),
                      )
                    }
                  >
                    设为入口
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => deleteFragment(selectedFragment)}
                  >
                    删除
                  </button>
                </div>
              </details>
            ) : null}
            <footer>
              <span /> {fragments.length} 个 Fragment · 自动保存已开启
            </footer>
          </aside>

          <button
            type="button"
            className={`galgame-structure-drawer-backdrop${structureDrawerOpen ? " is-open" : ""}`}
            aria-label="关闭剧本结构"
            onClick={() => setStructureDrawerOpen(false)}
          />

          <div
            className="galgame-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整故事结构栏宽度"
            aria-orientation="vertical"
            aria-valuemin={12}
            aria-valuemax={24}
            aria-valuenow={Math.round(scriptLayout.leftRatio)}
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={(event) => startSidebarResize("left", event)}
            onKeyDown={(event) => resizeSidebarWithKeyboard("left", event)}
            onDoubleClick={() => resetSidebarWidth("left")}
          />

          <main className="galgame-block-panel">
            {selectedFragment ? (
              <>
                <header className="galgame-block-toolbar">
                  <button
                    type="button"
                    className="galgame-structure-drawer-toggle"
                    aria-label="打开剧本结构"
                    onClick={() => setStructureDrawerOpen(true)}
                  >
                    <BookOpenText aria-hidden />
                  </button>
                  <div>
                    <input
                      aria-label="Fragment 名称"
                      value={selectedFragment.title}
                      onChange={(event) =>
                        replaceDocument(
                          updateFragment(
                            document,
                            selectedFragment.id,
                            (fragment) => ({
                              ...fragment,
                              title: event.target.value,
                            }),
                          ),
                        )
                      }
                    />
                    <small>
                      {storyBlockBundles(selectedFragment).length} 个可见 Block
                      {selectedFragment.timeline
                        ? ` · 精确演出 ${formatTimecode(selectedFragment.timeline.durationMs)}`
                        : " · 顺序执行"}
                    </small>
                  </div>
                  <nav
                    className="galgame-script-view-switch"
                    aria-label="剧本编辑视图"
                  >
                    <button
                      type="button"
                      aria-label="卡片"
                      title="卡片"
                      className={scriptView === "blocks" ? "active" : ""}
                      onClick={() => {
                        setScriptView("blocks");
                        setTimelinePreviewMs(null);
                        setSelectedTimelineGapId(undefined);
                      }}
                    >
                      <BookOpenText aria-hidden /> <span>卡片</span>
                    </button>
                    <button
                      type="button"
                      aria-label="纯文本"
                      title="纯文本"
                      className={scriptView === "plain" ? "active" : ""}
                      onClick={() => setScriptView("plain")}
                    >
                      <AlignLeft aria-hidden /> <span>纯文本</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Ren’Py"
                      title="Ren’Py"
                      className={scriptView === "renpy" ? "active" : ""}
                      onClick={() => setScriptView("renpy")}
                    >
                      <Code2 aria-hidden /> <span>Ren’Py</span>
                    </button>
                    <button
                      type="button"
                      aria-label="JSON OP"
                      title="JSON OP"
                      className={scriptView === "json" ? "active" : ""}
                      onClick={() => setScriptView("json")}
                    >
                      <Braces aria-hidden /> <span>JSON OP</span>
                    </button>
                    <button
                      type="button"
                      aria-label="演出"
                      title="演出时间轴"
                      className={scriptView === "performance" ? "active" : ""}
                      onClick={() => {
                        setScriptView("performance");
                        setPreviewMode("edit");
                      }}
                    >
                      <Clock3 aria-hidden /> <span>演出</span>
                    </button>
                  </nav>
                </header>
                {scriptView === "performance" && timelineFragment ? (
                  <StoryTimelineEditor
                    document={document}
                    fragment={timelineFragment}
                    selectedBlockId={
                      previewMode === "play"
                        ? playbackFollow?.blockId
                        : selectedBlockId
                    }
                    selectedGapId={
                      previewMode === "edit" ? selectedTimelineGapId : undefined
                    }
                    onRequestAddMenu={() => {
                      if (!playheadAddMenuRef.current) return;
                      playheadAddMenuRef.current.open = true;
                    }}
                    addControl={
                      previewMode === "edit" ? (
                        <TimelinePlayheadAddMenu
                          ref={playheadAddMenuRef}
                          positionMs={timelinePreviewMs ?? 0}
                          hasTerminator={terminates}
                          onAddBlock={addBlock}
                          onAddAllCharacters={addAllCharactersBlock}
                          onAddAudio={addAudioBlock}
                        />
                      ) : undefined
                    }
                    readOnly={previewMode === "play"}
                    followPositionMs={
                      previewMode === "play"
                        ? playbackFollow?.positionMs
                        : undefined
                    }
                    estimated={!timelineSourceFragment?.timeline}
                    onSelectBlock={(blockId) => {
                      setSelectedTimelineGapId(undefined);
                      setSelectedBlockId(blockId);
                      setInspectorTab("properties");
                    }}
                    onSelectGap={(gapId) => {
                      setSelectedBlockId(undefined);
                      setSelectedTimelineGapId(gapId);
                      setInspectorTab("properties");
                    }}
                    onFragment={(fragment) => {
                      if (previewMode === "play" || !selectedFragment) return;
                      replaceDocument(
                        updateFragment(
                          document,
                          selectedFragment.id,
                          () => fragment,
                        ),
                      );
                    }}
                    onPreviewPosition={previewTimelinePosition}
                    preferences={timelinePreferences}
                    onPreferencesChange={setTimelinePreferences}
                  />
                ) : scriptView === "plain" ? (
                  <PlainStoryView
                    document={document}
                    fragment={selectedFragment}
                    onFragment={(fragment) =>
                      replaceDocument(
                        updateFragment(
                          document,
                          selectedFragment.id,
                          () => fragment,
                        ),
                      )
                    }
                  />
                ) : scriptView === "renpy" ? (
                  <RenpyStoryView
                    document={document}
                    fragment={selectedFragment}
                    onFragment={(fragment) =>
                      replaceDocument(
                        updateFragment(
                          document,
                          selectedFragment.id,
                          () => fragment,
                        ),
                      )
                    }
                  />
                ) : scriptView === "json" ? (
                  <JsonStoryView fragment={selectedFragment} />
                ) : (
                  <StoryBlockEditor
                    document={document}
                    chapter={chapter}
                    fragment={selectedFragment}
                    selectedBlockId={selectedBlockId}
                    onSelectBlock={(blockId) => {
                      setSelectedTimelineGapId(undefined);
                      setSelectedBlockId(blockId);
                      setInspectorTab("properties");
                    }}
                    onBlock={(block) =>
                      replaceDocument(
                        updateBlock(
                          document,
                          selectedFragment.id,
                          block.id,
                          () => block,
                        ),
                      )
                    }
                    onAddBlock={addBlock}
                    onAddAllCharacters={addAllCharactersBlock}
                    onAddAudio={addAudioBlock}
                    onContinueDialogue={(source, beforeBundleId) => {
                      const block = continuingDialogueBlock(source);
                      pendingCardFocusRef.current = block.id;
                      insertPreparedBlock(block, beforeBundleId);
                    }}
                    onDeleteBlock={(blockId) => deleteSelected(blockId)}
                    onVoiceStale={(blockId) =>
                      setStaleVoiceBlocks((current) =>
                        new Set(current).add(blockId),
                      )
                    }
                  />
                )}
              </>
            ) : null}
          </main>

          <div
            className={`galgame-stage-resizer${stageViewportPreferences.collapsed ? " is-disabled" : ""}`}
            role="separator"
            tabIndex={0}
            aria-label={
              stageViewportPreferences.collapsed
                ? "舞台已折叠，按 Enter 展开"
                : "调整舞台与剧情时间轴高度"
            }
            aria-orientation="horizontal"
            aria-valuemin={24}
            aria-valuemax={72}
            aria-valuenow={Math.round(scriptLayout.previewSplitRatio)}
            aria-disabled={stageViewportPreferences.collapsed}
            title={
              stageViewportPreferences.collapsed
                ? "舞台已折叠，点击展开"
                : "拖动调整预览高度，双击恢复 60%"
            }
            onPointerDown={(event) => {
              if (stageViewportPreferences.collapsed) {
                event.preventDefault();
                setStageCollapsed(false);
                return;
              }
              startStageResize(event);
            }}
            onDoubleClick={() => {
              if (stageViewportPreferences.collapsed) {
                setStageCollapsed(false);
                return;
              }
              setScriptLayout((current) => ({
                ...current,
                previewSplitRatio: DEFAULT_SCRIPT_LAYOUT.previewSplitRatio,
              }));
            }}
            onKeyDown={(event) => {
              if (
                stageViewportPreferences.collapsed &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                setStageCollapsed(false);
                return;
              }
              if (stageViewportPreferences.collapsed) return;
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setScriptLayout((current) =>
                normalizeScriptLayout({
                  ...current,
                  previewSplitRatio:
                    current.previewSplitRatio +
                    (event.key === "ArrowDown" ? 2 : -2),
                }),
              );
            }}
          />

          <div
            className="galgame-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整预览检查栏宽度"
            aria-orientation="vertical"
            aria-valuemin={22}
            aria-valuemax={38}
            aria-valuenow={Math.round(scriptLayout.centerRatio)}
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={(event) => startSidebarResize("right", event)}
            onKeyDown={(event) => resizeSidebarWithKeyboard("right", event)}
            onDoubleClick={() => resetSidebarWidth("right")}
          />

          <aside className="galgame-preview-panel">
            <div
              ref={previewRef}
              tabIndex={-1}
              className="galgame-preview-focus"
            >
              <StoryPlayer
                key={previewReloadKey}
                ref={playerRef}
                document={document}
                startCursor={previewStart}
                mode={previewMode}
                collapsed={stageViewportPreferences.collapsed}
                onCollapsedChange={setStageCollapsed}
                viewportPreferences={stageViewportPreferences}
                onViewportPreferencesChange={setStageViewportPreferences}
                workbenchHeader
                headerModeControl={
                  <nav className="galgame-preview-mode" aria-label="预览模式">
                    <button
                      type="button"
                      className={previewMode === "edit" ? "active" : ""}
                      onClick={() => setPreviewMode("edit")}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={previewMode === "play" ? "active" : ""}
                      onClick={() => {
                        setPreviewMode("play");
                        setPlaybackFollow(undefined);
                        setTimelinePreviewMs(null);
                      }}
                    >
                      试玩
                    </button>
                    <button
                      type="button"
                      aria-label="定位所选 Block"
                      title="定位所选 Block"
                      disabled={!selectedBlockId}
                      onClick={() =>
                        selectedBlockId
                          ? globalThis.document
                              .querySelector(
                                `[data-block-id="${selectedBlockId}"]`,
                              )
                              ?.scrollIntoView({ block: "center" })
                          : undefined
                      }
                    >
                      <MapPinned aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="重载舞台预览"
                      title="重载舞台预览"
                      onClick={() => setPreviewReloadKey((value) => value + 1)}
                    >
                      <RefreshCcw aria-hidden />
                    </button>
                  </nav>
                }
                editFragment={selectedFragment}
                editTimelinePositionMs={
                  previewMode === "edit" ? timelinePreviewMs : null
                }
                editBlockIndex={
                  selectedIndex != null && selectedIndex >= 0
                    ? selectedIndex
                    : undefined
                }
                editableCharacterId={editableCharacterId}
                editableCgBlockId={editableCgBlockId}
                onCharacterPosition={(x, y) => {
                  if (!selectedBlock || !selectedFragment) return;
                  replaceDocument(
                    updateBlock(
                      document,
                      selectedFragment.id,
                      selectedBlock.id,
                      (current) => {
                        if (current.type === "showCharacter")
                          return {
                            ...current,
                            transform: {
                              ...characterTransform(current.transform),
                              x,
                              y,
                            },
                          };
                        if (current.type === "dialogue" && current.portrait) {
                          const stage = replayStageToBlock(
                            document,
                            selectedFragment,
                            selectedIndex ?? 0,
                          );
                          const inherited =
                            stage.actors[current.characterId]?.transform ??
                            DEFAULT_CHARACTER_TRANSFORM;
                          return {
                            ...current,
                            portrait: {
                              ...current.portrait,
                              transform: {
                                ...inherited,
                                ...current.portrait.transform,
                                x,
                                y,
                              },
                            },
                          };
                        }
                        return current;
                      },
                    ),
                  );
                }}
                onCgOverlayChange={(overlay) => {
                  if (
                    !selectedBlock ||
                    selectedBlock.type !== "showCg" ||
                    !selectedFragment
                  )
                    return;
                  replaceDocument(
                    updateBlock(
                      document,
                      selectedFragment.id,
                      selectedBlock.id,
                      (current) =>
                        current.type === "showCg"
                          ? { ...current, overlay }
                          : current,
                    ),
                  );
                }}
                onPlaybackPosition={setPlaybackFollow}
              />
            </div>
            <nav className="galgame-inspector-tabs" aria-label="Block 检查器">
              <strong>检查器</strong>
              <button
                type="button"
                title="属性"
                className={inspectorTab === "properties" ? "active" : ""}
                onClick={() => setInspectorTab("properties")}
              >
                <Settings2 aria-hidden /> <span>属性</span>
              </button>
              <button
                type="button"
                title="样式"
                className={inspectorTab === "appearance" ? "active" : ""}
                onClick={() => setInspectorTab("appearance")}
              >
                <Palette aria-hidden /> <span>样式</span>
              </button>
              <button
                type="button"
                title="线路检查"
                className={inspectorTab === "report" ? "active" : ""}
                onClick={() => setInspectorTab("report")}
              >
                <GitBranch aria-hidden /> <span>检查</span>
                {reportIssueCount > 0 ? (
                  <span className="galgame-inspector-count">
                    {reportIssueCount}
                  </span>
                ) : null}
              </button>
            </nav>
            <div className="galgame-inspector-body">
              {inspectorTab === "properties" ? (
                selectedTimelineGap && selectedFragment ? (
                  <TimelineGapInspector
                    gap={selectedTimelineGap}
                    fragment={projectedSelectedFragment ?? selectedFragment}
                    document={document}
                    onDocument={replaceDocument}
                  />
                ) : selectedBlock ? (
                  <BlockInspector
                    projectId={projectId}
                    block={selectedBlock}
                    document={document}
                    chapter={chapter}
                    fragmentId={selectedFragment?.id ?? ""}
                    onDocument={replaceDocument}
                    onNotice={setNotice}
                    voiceStale={Boolean(
                      selectedBlock && staleVoiceBlocks.has(selectedBlock.id),
                    )}
                    onVoiceStale={() =>
                      selectedBlockId &&
                      setStaleVoiceBlocks((current) =>
                        new Set(current).add(selectedBlockId),
                      )
                    }
                    onVoiceFresh={() =>
                      selectedBlockId &&
                      setStaleVoiceBlocks((current) => {
                        const next = new Set(current);
                        next.delete(selectedBlockId);
                        return next;
                      })
                    }
                    timelinePreferences={timelinePreferences}
                    onMoveUp={() => moveSelected(-1, selectedBlock.id)}
                    onMoveDown={() => moveSelected(1, selectedBlock.id)}
                    onDelete={() => deleteSelected(selectedBlock.id)}
                    canMoveUp={Boolean(
                      scriptView !== "performance" && selectedFragment
                        ? canMoveStoryBlockBundle(
                            selectedFragment,
                            selectedBlock.id,
                            -1,
                          )
                        : selectedIndex != null && selectedIndex > 0,
                    )}
                    canMoveDown={Boolean(
                      scriptView !== "performance" && selectedFragment
                        ? canMoveStoryBlockBundle(
                            selectedFragment,
                            selectedBlock.id,
                            1,
                          )
                        : selectedIndex != null &&
                            selectedIndex >= 0 &&
                            selectedIndex <
                              (selectedFragment?.blocks?.length ?? 0) - 1,
                    )}
                  />
                ) : selectedFragment && projectedSelectedFragment ? (
                  <FragmentOverviewInspector
                    fragment={selectedFragment}
                    durationMs={
                      projectedSelectedFragment.timeline?.durationMs ?? 0
                    }
                    isEntry={chapter.entryFragmentId === selectedFragment.id}
                    estimated={!selectedFragment.timeline}
                  />
                ) : (
                  <div className="galgame-inspector-empty">
                    <Settings2 aria-hidden />
                    <strong>未选择 Fragment</strong>
                  </div>
                )
              ) : inspectorTab === "appearance" ? (
                <DialogueStyleInspector
                  projectId={projectId}
                  document={document}
                  onDocument={replaceDocument}
                />
              ) : (
                <RouteReportInspector
                  report={report}
                  document={savedDocument}
                  error={reportQuery.error}
                  refreshing={reportRefreshing}
                  saving={saveState === "saving"}
                  onIssue={locateIssue}
                  onRoute={locateRoute}
                  onOpen={() => setReportOpen(true)}
                  onRefresh={() => void reportQuery.refetch()}
                />
              )}
            </div>
          </aside>
        </div>
      ) : workspace === "assets" ? (
        <AssetCenter
          projectId={projectId}
          document={document}
          storyRevision={revisionRef.current}
          section={assetSection}
          visualSection={visualSection}
          focusVisual={focusedVisual}
          onFocusVisualHandled={() => setFocusedVisual(undefined)}
          focusCharacterId={focusedCharacterId}
          onSection={setAssetSection}
          onVisualSection={setVisualSection}
          onDocument={replaceDocument}
          onCommitDocument={commitDocument}
          onRepairMissingAsset={repairMissingAsset}
          onUpgradePortraitSizes={upgradePortraitSizes}
          onNotice={setNotice}
          onCharacter={(characterId) => {
            setFocusedCharacterId(characterId);
            setAssetSection("characters");
          }}
          onLocate={(chapterId, fragmentId, blockId) => {
            const targetChapter =
              (chapterId ? chapterById(document, chapterId) : undefined) ??
              document.chapters?.find((item) =>
                item.fragments?.some((fragment) => fragment.id === fragmentId),
              );
            if (targetChapter) {
              setSelectedChapterId(targetChapter.id);
              const fragment = fragmentById(targetChapter, fragmentId);
              if (fragment) selectFragment(fragment);
            }
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : workspace === "narrative" ? (
        <NarrativeMapWorkspace
          document={document}
          onDocument={replaceDocument}
          onLocate={(chapterId, fragmentId, blockId) => {
            const targetChapter = chapterById(document, chapterId);
            const targetFragment = targetChapter
              ? fragmentById(targetChapter, fragmentId)
              : undefined;
            if (targetChapter) setSelectedChapterId(targetChapter.id);
            if (targetFragment) setSelectedFragmentId(targetFragment.id);
            setSelectedBlockId(blockId ?? targetFragment?.blocks?.[0]?.id);
            setSelectedTimelineGapId(undefined);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : workspace === "personalization" ? (
        <PersonalizationWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
        />
      ) : (
        <ProjectSettingsWorkspace
          title={projectQuery.data?.title ?? ""}
          document={document}
          savingTitle={titleSaving}
          onTitle={updateProjectTitle}
          onDocument={replaceDocument}
        />
      )}

      <footer className="galgame-editor-statusbar">
        <span className={saveState}>
          <i />
          自动保存
          {saveState === "saved"
            ? "已开启"
            : saveState === "saving"
              ? "中"
              : "需处理"}
        </span>
        <span>
          {WORKSPACES.find((item) => item.id === workspace)?.label}
          {workspace === "script"
            ? ` / ${chapter.title} / ${selectedFragment?.title ?? ""}`
            : ""}
        </span>
        <span className={reportIssueCount ? "warning" : "healthy"}>
          {reportIssueCount ? `${reportIssueCount} 个线路问题` : "线路正常"}
        </span>
        <a
          href="https://docs.avg-engine.com/manual/overview/editor"
          target="_blank"
          rel="noreferrer"
        >
          帮助文档
        </a>
        <span>Story {document.schemaVersion}</span>
      </footer>

      <GlobalStorySearch
        open={commandOpen}
        document={document}
        onClose={() => setCommandOpen(false)}
        onSelect={locateSearchTarget}
      />

      <RouteReportDialog
        open={reportOpen}
        report={report}
        document={savedDocument}
        error={reportQuery.error}
        refreshing={reportRefreshing}
        saving={saveState === "saving"}
        onClose={() => setReportOpen(false)}
        onIssue={(issue) => {
          setReportOpen(false);
          locateIssue(issue);
        }}
        onRoute={(route) => {
          setReportOpen(false);
          locateRoute(route);
        }}
        onRefresh={() => void reportQuery.refetch()}
      />

      {conflict ? (
        <div className="galgame-conflict" role="alert">
          <span>
            <strong>故事存在更新冲突</strong>
            本地草稿仍保留，请选择要使用的版本。
          </span>
          <button
            type="button"
            onClick={() => {
              const next = completeStoryDocument(conflict.document);
              const nextChapter = entryChapter(next);
              const nextFragment = nextChapter?.fragments?.find(
                (fragment) => fragment.id === nextChapter.entryFragmentId,
              );
              revisionRef.current = conflict.revision;
              documentRef.current = next;
              conflictRef.current = false;
              client.setQueryData(STORY_KEY(projectId), conflict);
              setDocument(next);
              setSelectedChapterId(nextChapter?.id ?? "chapter-1");
              setSelectedFragmentId(
                nextFragment?.id ?? nextChapter?.fragments?.[0]?.id ?? "main",
              );
              setSelectedBlockId(undefined);
              setConflict(undefined);
              setSaveState("saved");
            }}
          >
            载入服务器版本
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => setConfirmOverwrite(true)}
          >
            用本地版本覆盖
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOverwrite && Boolean(conflict)}
        title="用本地草稿覆盖服务器版本？"
        description="这会以服务器最新 revision 为基准保存当前本地草稿，服务器上的故事内容将被替换。"
        confirmLabel="确认覆盖"
        onCancel={() => setConfirmOverwrite(false)}
        onConfirm={() => {
          if (!conflict) return;
          revisionRef.current = conflict.revision;
          conflictRef.current = false;
          setConflict(undefined);
          setConfirmOverwrite(false);
          enqueueSave(documentRef.current!);
        }}
      />
    </section>
  );
}
