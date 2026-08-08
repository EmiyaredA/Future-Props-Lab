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
  BookOpenText,
  ChevronDown,
  Clock3,
  Flag,
  GitBranch,
  MapPinned,
  MessageSquareText,
  Music2,
  Plus,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  putGalgameStoryDocument,
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryCharacterTransform,
  type GalgameStoryCharacterTransition,
  type GalgameStoryDocument,
  type GalgameStoryFragment,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { DialogueVoiceBinding } from "@features/galgame-workshop/editor/DialogueVoiceBinding";
import {
  dialogueSpeakerIds,
  withDialogueSpeakers,
} from "@features/galgame-workshop/editor/dialogue";
import { StoryTimelineEditor } from "@features/galgame-workshop/editor/StoryTimelineEditor";
import type { TimelineBeatSelection } from "@features/galgame-workshop/editor/StoryTimelineEditor";
import {
  loadTimelinePreferences,
  storeTimelinePreferences,
  type TimelinePreferences,
} from "@features/galgame-workshop/editor/timelinePreferences";
import {
  completeStoryDocument,
  firstChapter,
  fragmentById,
  isTerminator,
  makeBlock,
  makeAudioBlock,
  moveItem,
  referencedBy,
  stableId,
  type BlockKind,
  type EditorWorkspace,
  updateBlock,
  updateFirstChapter,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  StoryPlayer,
  type StoryPlayerHandle,
} from "@features/galgame-workshop/editor/StoryPlayer";
import {
  CHARACTER_POSITION_MAX,
  CHARACTER_POSITION_MIN,
  characterTransform,
  characterTransition,
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
  replayStageAtTime,
  replayStageToBlock,
  visibleStageActors,
} from "@features/galgame-workshop/editor/stage";
import {
  appendBlockToTimeline,
  deleteTimelineBeatRange,
  duplicateTimelineBeatRange,
  effectivePointTime,
  formatTimecode,
  parseTimecode,
  projectFragmentTimeline,
  resizeTimelineCueEnd,
  scaleTimelineBeatRange,
  setTimelineCueEdge,
  setTimelineGapEdge,
  setTimelinePointTime,
  timelineAudioStateAt,
  timelineBeatRange,
  timelineBeats,
  timelineGaps,
  translateTimelineBeatRange,
  type GalgameTimelineGap,
} from "@features/galgame-workshop/editor/timeline";
import { CharacterWorkspace } from "@features/galgame-workshop/editor/CharacterWorkspace";
import { SceneWorkspace } from "@features/galgame-workshop/editor/SceneWorkspace";
import { SoundWorkspace } from "@features/galgame-workshop/editor/SoundWorkspace";
import { DialogueStyleInspector } from "@features/galgame-workshop/editor/DialogueStyleInspector";
import {
  RouteReportDialog,
  RouteReportInspector,
  type GalgameStoryReportIssue,
  type StoryRoute,
} from "@features/galgame-workshop/editor/RouteReport";
import "@features/galgame-workshop/galgame-workshop.css";

const STORY_KEY = (projectId: string) =>
  ["galgame-workshop-story", projectId] as const;
const REPORT_KEY = (projectId: string) =>
  ["galgame-workshop-story-report", projectId] as const;
const PROJECT_KEY = (projectId: string) =>
  ["galgame-workshop-project", projectId] as const;

type SaveState = "saved" | "saving" | "error" | "conflict";
type InspectorTab = "properties" | "appearance" | "report";

const WORKSPACES: Array<{
  id: EditorWorkspace;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { id: "script", label: "剧本", icon: BookOpenText },
  { id: "characters", label: "角色", icon: Users },
  { id: "scenes", label: "场景", icon: MapPinned },
  { id: "audio", label: "声音", icon: Music2 },
];

const BLOCK_LABELS: Record<BlockKind, string> = {
  scene: "场景",
  showCharacter: "角色登场 / 调整",
  removeCharacter: "角色退场",
  narration: "旁白",
  dialogue: "对白",
  audio: "声音",
  branch: "分支",
  endChapter: "章节结局",
};

const SIDEBAR_WIDTHS_KEY = "future_props_galgame_editor_sidebar_widths";
const STAGE_SPLIT_KEY = "future_props_galgame_editor_stage_split";
const SIDEBAR_GUTTER_WIDTH = 12;
const SIDEBAR_LIMITS = {
  left: { min: 180, max: 360 },
  right: { min: 280, max: 520 },
} as const;

type SidebarSide = keyof typeof SIDEBAR_LIMITS;
type SidebarWidths = Record<SidebarSide, number>;

function defaultSidebarWidths(
  viewportWidth = window.innerWidth,
): SidebarWidths {
  return viewportWidth <= 1240
    ? { left: 210, right: 330 }
    : { left: 230, right: 380 };
}

function loadSidebarWidths(): SidebarWidths {
  try {
    const stored = JSON.parse(
      localStorage.getItem(SIDEBAR_WIDTHS_KEY) ?? "null",
    ) as Partial<SidebarWidths> | null;
    if (
      stored &&
      typeof stored.left === "number" &&
      typeof stored.right === "number"
    ) {
      return {
        left: clamp(
          stored.left,
          SIDEBAR_LIMITS.left.min,
          SIDEBAR_LIMITS.left.max,
        ),
        right: clamp(
          stored.right,
          SIDEBAR_LIMITS.right.min,
          SIDEBAR_LIMITS.right.max,
        ),
      };
    }
  } catch {
    // Ignore stale layout preferences and fall back to responsive defaults.
  }
  return defaultSidebarWidths();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadStageSplit() {
  const stored = Number(localStorage.getItem(STAGE_SPLIT_KEY));
  return Number.isFinite(stored) && stored >= 24 && stored <= 72 ? stored : 42;
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

function blockSummary(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
  chapter: GalgameStoryChapter,
) {
  if (block.type === "scene")
    return (
      document.scenes?.find((scene) => scene.id === block.sceneId)?.name ??
      "未知场景"
    );
  if (block.type === "narration") return block.text || "（空旁白）";
  if (block.type === "dialogue") return block.text || "（空对白）";
  if (block.type === "showCharacter") {
    const character = document.characters?.find(
      (candidate) => candidate.id === block.characterId,
    );
    const transform = characterTransform(block.transform);
    return `${character?.name ?? "未知角色"} · X ${Math.round(transform.x)}% · ${Math.round(transform.scale * 100)}%`;
  }
  if (block.type === "removeCharacter") {
    if (block.all) return "全部角色";
    return (
      document.characters?.find(
        (candidate) => candidate.id === block.characterId,
      )?.name ?? "未知角色"
    );
  }
  if (block.type === "audio") {
    if (block.action === "stop")
      return `停止${{ bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[block.channel]}`;
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === block.assetId,
    );
    return `${asset?.type === "audio" ? asset.label : "未知声音"} · ${block.volume}%`;
  }
  if (block.type === "endChapter") return block.label;
  if (block.type !== "branch") return "";
  return block.choices
    .map((choice) => {
      const target = chapter.fragments?.find(
        (fragment) => fragment.id === choice.targetFragmentId,
      );
      return `${choice.text || "未命名选项"} → ${target?.title ?? "未知目标"}`;
    })
    .join(" · ");
}

function formatMilliseconds(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((milliseconds % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

function CharacterTransitionFields({
  transition,
  onChange,
}: {
  transition?: GalgameStoryCharacterTransition;
  onChange: (transition: GalgameStoryCharacterTransition) => void;
}) {
  const value = characterTransition(transition);
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
        <span>登退场淡入淡出</span>
      </label>
      <label className="galgame-stage-range">
        <span>
          过渡时长 <em>{value.durationMs}ms</em>
        </span>
        <input
          aria-label="角色过渡时长"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={value.durationMs}
          onChange={(event) =>
            onChange({ ...value, durationMs: Number(event.target.value) })
          }
        />
      </label>
    </div>
  );
}

function CharacterTransformFields({
  transform,
  transition,
  onTransform,
  onTransition,
}: {
  transform?: GalgameStoryCharacterTransform | null;
  transition?: GalgameStoryCharacterTransition;
  onTransform: (transform: GalgameStoryCharacterTransform) => void;
  onTransition: (transition: GalgameStoryCharacterTransition) => void;
}) {
  const value = characterTransform(transform);
  const fields = [
    ["x", "X 位置", CHARACTER_POSITION_MIN, CHARACTER_POSITION_MAX, 1, "%"],
    ["y", "Y 位置", CHARACTER_POSITION_MIN, CHARACTER_POSITION_MAX, 1, "%"],
    ["scale", "比例", 0.25, 3, 0.05, "×"],
    ["brightness", "亮度", 0, 2, 0.05, "×"],
    ["opacity", "透明度", 0, 1, 0.05, ""],
    ["layer", "层级", 0, 20, 1, ""],
  ] as const;
  return (
    <div className="galgame-character-transform-fields">
      <div className="galgame-position-presets" aria-label="角色站位预设">
        {[
          ["左", 25],
          ["中", 50],
          ["右", 75],
        ].map(([label, x]) => (
          <button
            key={label}
            type="button"
            onClick={() => onTransform({ ...value, x: Number(x), y: 100 })}
          >
            {label}
          </button>
        ))}
      </div>
      {fields.map(([key, label, min, max, step, suffix]) => (
        <label key={key} className="galgame-stage-range">
          <span>
            {label} <em>{`${value[key]}${suffix}`}</em>
          </span>
          <span>
            <input
              aria-label={`角色${label}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onTransform({ ...value, [key]: Number(event.target.value) })
              }
            />
            <input
              aria-label={`角色${label}数值`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onTransform({
                  ...value,
                  [key]: clamp(Number(event.target.value), min, max),
                })
              }
            />
          </span>
        </label>
      ))}
      <label className="galgame-stage-checkbox">
        <input
          type="checkbox"
          checked={value.flipX}
          onChange={(event) =>
            onTransform({ ...value, flipX: event.target.checked })
          }
        />
        <span>水平翻转立绘</span>
      </label>
      <CharacterTransitionFields
        transition={transition}
        onChange={onTransition}
      />
    </div>
  );
}

function BeatRangeInspector({
  fragment,
  selection,
  document,
  onSelectBlock,
  onApply,
  onRequestDelete,
}: {
  fragment: GalgameStoryFragment;
  selection: TimelineBeatSelection;
  document: GalgameStoryProject;
  onSelectBlock: (blockId: string) => void;
  onApply: (result: { fragment: GalgameStoryFragment; error?: string }) => void;
  onRequestDelete: () => void;
}) {
  const [moveMs, setMoveMs] = useState(0);
  const [scalePercent, setScalePercent] = useState(100);
  const beats = timelineBeats(fragment);
  const range = timelineBeatRange(
    fragment,
    selection.startIndex,
    selection.endIndex,
  );
  if (!range)
    return (
      <div className="galgame-inspector-empty">
        <Settings2 aria-hidden />
        <strong>当前没有 Beat</strong>
        <span>在播放头添加对白、舞台或声音事件后即可开始编排。</span>
      </div>
    );
  const selectedBeats = beats.slice(range.startIndex, range.endIndex + 1);
  const selectedBlocks = (fragment.blocks ?? []).filter((block) =>
    range.blockIds.includes(block.id),
  );
  const counts = selectedBlocks.reduce<Record<string, number>>(
    (result, block) => ({
      ...result,
      [BLOCK_LABELS[block.type]]: (result[BLOCK_LABELS[block.type]] ?? 0) + 1,
    }),
    {},
  );
  const firstBeat = selectedBeats[0];
  const stage = replayStageAtTime(document, fragment, firstBeat.startMs).stage;
  const audio = timelineAudioStateAt(fragment, firstBeat.startMs);
  const sceneName = (document.scenes ?? []).find(
    (scene) => scene.id === stage.sceneId,
  )?.name;
  const actorNames = visibleStageActors(stage).map(
    (actor) =>
      (document.characters ?? []).find(
        (character) => character.id === actor.characterId,
      )?.name ?? actor.characterId,
  );
  const audioName = (assetId?: string | null) => {
    const asset = (document.assets ?? []).find((item) => item.id === assetId);
    return asset?.type === "audio" ? asset.label : "静音";
  };
  const single = range.startIndex === range.endIndex;

  return (
    <div className="galgame-beat-range-inspector">
      <header>
        <span>
          <strong>
            {single
              ? `Beat ${range.startIndex + 1}`
              : `Beat ${range.startIndex + 1}–${range.endIndex + 1}`}
          </strong>
          <small>
            {formatTimecode(range.startMs)}–{formatTimecode(range.endMs)}
          </small>
        </span>
        {range.structuralBlockIds.length ? <em>含受保护结构 Beat</em> : null}
      </header>
      <div className="galgame-beat-range-metrics">
        <span>
          <small>范围时长</small>
          <strong>{formatTimecode(range.durationMs)}</strong>
        </span>
        <span>
          <small>Beat</small>
          <strong>{selectedBeats.length}</strong>
        </span>
        <span>
          <small>事件</small>
          <strong>{selectedBlocks.length}</strong>
        </span>
      </div>
      {single ? (
        <>
          <section className="galgame-beat-state-summary">
            <strong>开始时持续状态</strong>
            <span>场景 · {sceneName ?? "未设置"}</span>
            <span>
              在场 · {actorNames.length ? actorNames.join("、") : "无角色"}
            </span>
            <span>BGM · {audioName(audio.bgm?.assetId)}</span>
            <span>环境 · {audioName(audio.ambient?.assetId)}</span>
          </section>
          <section className="galgame-beat-event-list">
            <strong>Beat 内事件</strong>
            {selectedBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => onSelectBlock(block.id)}
              >
                <BlockTypeIcon type={block.type} />
                <span>
                  <strong>{BLOCK_LABELS[block.type]}</strong>
                  <small>
                    {blockSummary(block, document, firstChapter(document)!)}
                  </small>
                </span>
              </button>
            ))}
          </section>
        </>
      ) : (
        <section className="galgame-beat-range-counts">
          <strong>事件统计</strong>
          {Object.entries(counts).map(([label, count]) => (
            <span key={label}>
              {label}
              <em>{count}</em>
            </span>
          ))}
        </section>
      )}
      <section className="galgame-beat-range-actions">
        <strong>范围操作 · 自动波纹后续 Beat</strong>
        <label>
          <span>整体平移</span>
          <input
            type="number"
            step="100"
            value={moveMs}
            onChange={(event) => setMoveMs(Number(event.target.value))}
          />
          <em>ms</em>
          <button
            type="button"
            onClick={() =>
              onApply(
                translateTimelineBeatRange(
                  fragment,
                  range.startIndex,
                  range.endIndex,
                  moveMs,
                ),
              )
            }
          >
            应用
          </button>
        </label>
        <label>
          <span>范围缩放</span>
          <input
            type="number"
            min="1"
            step="5"
            value={scalePercent}
            onChange={(event) => setScalePercent(Number(event.target.value))}
          />
          <em>%</em>
          <button
            type="button"
            onClick={() =>
              onApply(
                scaleTimelineBeatRange(
                  fragment,
                  range.startIndex,
                  range.endIndex,
                  scalePercent / 100,
                ),
              )
            }
          >
            应用
          </button>
        </label>
        <div>
          <button
            type="button"
            onClick={() =>
              onApply(
                duplicateTimelineBeatRange(
                  fragment,
                  range.startIndex,
                  range.endIndex,
                  () => stableId(),
                ),
              )
            }
          >
            复制到范围之后
          </button>
          <button type="button" className="danger" onClick={onRequestDelete}>
            删除并闭合空隙
          </button>
        </div>
        <small>分支和章节结局参与统计，但不会被复制、删除、移动或缩放。</small>
      </section>
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
      {(block.type === "dialogue" || block.type === "narration") &&
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
      {(block.type === "scene" ||
        block.type === "showCharacter" ||
        block.type === "removeCharacter" ||
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
                        backgroundId: null,
                      }
                    : current,
                )
              }
            />
          </Field>
          <Field label="背景状态">
            <CustomSelect
              ariaLabel="背景状态"
              value={block.backgroundId ?? ""}
              options={(() => {
                const scene = (document.scenes ?? []).find(
                  (candidate) => candidate.id === block.sceneId,
                );
                const defaultBackground = (scene?.backgrounds ?? []).find(
                  (background) => background.id === scene?.defaultBackgroundId,
                );
                return [
                  {
                    value: "",
                    label: `跟随场景默认 · ${defaultBackground?.label ?? "主题占位"}`,
                  },
                  ...(scene?.backgrounds ?? []).map((background) => ({
                    value: background.id,
                    label: background.label,
                  })),
                ];
              })()}
              onChange={(backgroundId) =>
                patch((current) =>
                  current.type === "scene"
                    ? {
                        ...current,
                        backgroundId: backgroundId || null,
                      }
                    : current,
                )
              }
            />
          </Field>
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
        <Field label="旁白正文">
          <textarea
            value={block.text}
            placeholder="写下旁白…"
            onChange={(event) =>
              patch((current) =>
                current.type === "narration"
                  ? { ...current, text: event.target.value }
                  : current,
              )
            }
          />
        </Field>
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
          <Field label="对白正文">
            <textarea
              value={block.text}
              placeholder="写下对白…"
              onChange={(event) => {
                if (block.voiceAssetId && event.target.value !== block.text)
                  onVoiceStale();
                patch((current) =>
                  current.type === "dialogue"
                    ? { ...current, text: event.target.value }
                    : current,
                );
              }}
            />
          </Field>
          <Field label="立绘演出">
            <CustomSelect
              ariaLabel="对白立绘模式"
              value={block.portrait?.mode ?? "legacy"}
              options={[
                { value: "legacy", label: "旧版单人临时立绘" },
                { value: "stage", label: "加入 / 更新多人舞台" },
                { value: "solo", label: "临时单人画面" },
                { value: "hidden", label: "隐藏当前角色立绘" },
              ]}
              onChange={(mode) =>
                patch((current) => {
                  if (current.type !== "dialogue") return current;
                  if (mode === "legacy") return { ...current, portrait: null };
                  return {
                    ...current,
                    portrait: {
                      mode: mode as "stage" | "solo" | "hidden",
                      keepAfter: mode === "stage",
                      transform: null,
                      transition: DEFAULT_CHARACTER_TRANSITION,
                    },
                  };
                })
              }
            />
          </Field>
          {block.portrait?.mode === "stage" ? (
            <>
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
            </>
          ) : null}
          {block.portrait &&
          block.portrait.mode !== "hidden" &&
          (block.portrait.mode === "solo" || block.portrait.transform) ? (
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
          ) : block.portrait ? (
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
          ) : null}
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
      ) : null}
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
        无对白区间不会新增
        Block；剧情时钟继续推进，参考声轨结束后保持静音，舞台保留并隐藏对话框。
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
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [workspace, setWorkspace] = useState<EditorWorkspace>("script");
  const [previewMode, setPreviewMode] = useState<"edit" | "play">("edit");
  const [stageSplit, setStageSplit] = useState(loadStageSplit);
  const [beatSelection, setBeatSelection] = useState<TimelineBeatSelection>({
    anchorIndex: 0,
    startIndex: 0,
    endIndex: 0,
  });
  const [playbackBeatSelection, setPlaybackBeatSelection] =
    useState<TimelineBeatSelection>({
      anchorIndex: 0,
      startIndex: 0,
      endIndex: 0,
    });
  const [playbackFollow, setPlaybackFollow] = useState<{
    fragmentId: string;
    positionMs: number;
    blockId?: string;
  }>();
  const [timelinePreviewMs, setTimelinePreviewMs] = useState<number | null>(
    null,
  );
  const [timelineAudioLevelDb, setTimelineAudioLevelDb] = useState<
    number | null
  >(null);
  const [timelineAudioPlaying, setTimelineAudioPlaying] = useState(false);
  const [timelinePreferences, setTimelinePreferences] =
    useState<TimelinePreferences>(loadTimelinePreferences);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [sidebarWidths, setSidebarWidths] =
    useState<SidebarWidths>(loadSidebarWidths);
  const [document, setDocument] = useState<GalgameStoryProject>();
  const [selectedFragmentId, setSelectedFragmentId] = useState("main");
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [selectedTimelineGapId, setSelectedTimelineGapId] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<GalgameStoryDocument>();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [confirmRangeDelete, setConfirmRangeDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [staleVoiceBlocks, setStaleVoiceBlocks] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedCharacterId, setFocusedCharacterId] = useState<string>();

  useEffect(() => {
    storeTimelinePreferences(timelinePreferences);
  }, [timelinePreferences]);

  useEffect(() => {
    localStorage.setItem(STAGE_SPLIT_KEY, String(stageSplit));
  }, [stageSplit]);

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
      const nextChapter = firstChapter(next);
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
      setSelectedFragmentId(targetFragment?.id ?? "main");
      setSelectedBlockId(preservedBlock?.id ?? targetFragment?.blocks?.[0]?.id);
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
    const entry = firstChapter(next)?.entryFragmentId ?? "main";
    const entryFragment = firstChapter(next)?.fragments?.find(
      (fragment) => fragment.id === entry,
    );
    initialized.current = true;
    revisionRef.current = storyQuery.data.revision;
    documentRef.current = next;
    setDocument(next);
    setSelectedFragmentId(entry);
    setSelectedBlockId(entryFragment?.blocks?.[0]?.id);
  }, [
    saveState,
    selectedBlockId,
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
    localStorage.setItem(SIDEBAR_WIDTHS_KEY, JSON.stringify(sidebarWidths));
  }, [sidebarWidths]);

  useEffect(() => {
    const fitSidebarsToViewport = () => {
      if (window.innerWidth <= 980) return;
      const centerMinimum = window.innerWidth <= 1240 ? 420 : 480;
      const available =
        window.innerWidth - centerMinimum - SIDEBAR_GUTTER_WIDTH;
      setSidebarWidths((current) => {
        let left = clamp(
          current.left,
          SIDEBAR_LIMITS.left.min,
          SIDEBAR_LIMITS.left.max,
        );
        let right = clamp(
          current.right,
          SIDEBAR_LIMITS.right.min,
          SIDEBAR_LIMITS.right.max,
        );
        let overflow = Math.max(0, left + right - available);
        const rightReduction = Math.min(
          overflow,
          right - SIDEBAR_LIMITS.right.min,
        );
        right -= rightReduction;
        overflow -= rightReduction;
        left -= Math.min(overflow, left - SIDEBAR_LIMITS.left.min);
        return left === current.left && right === current.right
          ? current
          : { left, right };
      });
    };
    fitSidebarsToViewport();
    window.addEventListener("resize", fitSidebarsToViewport);
    return () => window.removeEventListener("resize", fitSidebarsToViewport);
  }, []);

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

  const chapter = firstChapter(document)!;
  const fragments = chapter.fragments ?? [];
  const selectedFragment =
    fragmentById(chapter, selectedFragmentId) ?? fragments[0];
  const projectedSelectedFragment = selectedFragment
    ? projectFragmentTimeline(selectedFragment)
    : undefined;
  const playbackSourceFragment = playbackFollow
    ? fragmentById(chapter, playbackFollow.fragmentId)
    : undefined;
  const timelineSourceFragment =
    previewMode === "play" && playbackSourceFragment
      ? playbackSourceFragment
      : selectedFragment;
  const timelineFragment = timelineSourceFragment
    ? projectFragmentTimeline(timelineSourceFragment)
    : undefined;
  const selectedBlock = selectedFragment?.blocks?.find(
    (block) => block.id === selectedBlockId,
  );
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
    (block) => block.id === selectedBlockId,
  );
  const lastBlock = selectedFragment?.blocks?.at(-1);
  const terminates = lastBlock ? isTerminator(lastBlock) : false;
  const editableCharacterId =
    selectedBlock?.type === "showCharacter" ||
    (selectedBlock?.type === "dialogue" &&
      selectedBlock.portrait &&
      selectedBlock.portrait.mode !== "hidden")
      ? selectedBlock.characterId
      : undefined;

  const selectFragment = (fragment: GalgameStoryFragment) => {
    setSelectedFragmentId(fragment.id);
    setSelectedTimelineGapId(undefined);
    setSelectedBlockId(fragment.blocks?.[0]?.id);
    setBeatSelection({ anchorIndex: 0, startIndex: 0, endIndex: 0 });
    setTimelinePreviewMs(null);
  };
  const addFragment = () => {
    const id = stableId();
    replaceDocument(
      updateFirstChapter(document, (current) => ({
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
      updateFirstChapter(document, (current) => ({
        ...current,
        fragments: remaining,
      })),
    );
    selectFragment(remaining[0]);
  };
  const addBlock = (kind: BlockKind) => {
    if (!selectedFragment) return;
    const block = makeBlock(kind, document, chapter, selectedFragment);
    if (!block) {
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
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) =>
        appendBlockToTimeline(
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
  const addAllCharactersBlock = () => {
    if (!selectedFragment) return;
    const block: GalgameStoryBlock = {
      id: stableId(),
      type: "removeCharacter",
      characterId: null,
      all: true,
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) =>
        appendBlockToTimeline(
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
  const addAudioBlock = (
    action: "play" | "stop",
    channel: "bgm" | "ambient" | "sfx",
  ) => {
    if (!selectedFragment) return;
    const block = makeAudioBlock(document, action, channel);
    if (!block) {
      setNotice(
        `请先在声音工作区添加${
          { bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[channel]
        }素材。`,
      );
      setWorkspace("audio");
      return;
    }
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) =>
        appendBlockToTimeline(
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
  const moveSelected = (direction: -1 | 1) => {
    if (!selectedFragment || selectedIndex === undefined || selectedIndex < 0)
      return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => ({
        ...fragment,
        blocks: moveItem(fragment.blocks ?? [], selectedIndex, direction),
      })),
    );
  };
  const deleteSelected = () => {
    if (!selectedFragment || !selectedBlock) return;
    const blocks = selectedFragment.blocks ?? [];
    const index = blocks.findIndex((block) => block.id === selectedBlock.id);
    const remaining = blocks.filter((block) => block.id !== selectedBlock.id);
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => ({
        ...fragment,
        blocks: remaining,
      })),
    );
    setSelectedBlockId(remaining[Math.min(index, remaining.length - 1)]?.id);
    setSelectedTimelineGapId(undefined);
  };
  const applyBeatRangeResult = (result: {
    fragment: GalgameStoryFragment;
    error?: string;
  }) => {
    if (!selectedFragment) return;
    if (result.error) {
      setNotice(result.error);
      return;
    }
    replaceDocument(
      updateFragment(document, selectedFragment.id, () => result.fragment),
    );
    setSelectedBlockId(undefined);
    setSelectedTimelineGapId(undefined);
  };
  const locateIssue = (issue: GalgameStoryReportIssue) => {
    if (issue.fragment_id) {
      const fragment = fragmentById(chapter, issue.fragment_id);
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
      setSelectedFragmentId(fragment.id);
      setSelectedTimelineGapId(undefined);
      setSelectedBlockId(route.blockId);
    }
    setWorkspace("script");
    setInspectorTab("properties");
  };
  const startPreview = () => {
    setWorkspace("script");
    setPreviewMode("play");
    requestAnimationFrame(() => {
      playerRef.current?.restart();
      previewRef.current?.focus();
    });
  };

  const startStageResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.innerWidth <= 980) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    const move = (pointer: PointerEvent) => {
      const bounds = editorGridRef.current
        ?.querySelector(".galgame-compose-panel")
        ?.getBoundingClientRect();
      if (!bounds) return;
      setStageSplit(
        clamp(((pointer.clientY - bounds.top) / bounds.height) * 100, 24, 72),
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

  const constrainedSidebarWidth = (
    side: SidebarSide,
    requestedWidth: number,
  ) => {
    const gridWidth =
      editorGridRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const centerMinimum = gridWidth <= 1240 ? 420 : 480;
    const oppositeWidth =
      side === "left" ? sidebarWidths.right : sidebarWidths.left;
    const availableMaximum =
      gridWidth - oppositeWidth - centerMinimum - SIDEBAR_GUTTER_WIDTH;
    const limits = SIDEBAR_LIMITS[side];
    return clamp(
      requestedWidth,
      limits.min,
      Math.max(limits.min, Math.min(limits.max, availableMaximum)),
    );
  };

  const setSidebarWidth = (side: SidebarSide, requestedWidth: number) => {
    setSidebarWidths((current) => ({
      ...current,
      [side]: constrainedSidebarWidth(side, requestedWidth),
    }));
  };

  const startSidebarResize = (
    side: SidebarSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    globalThis.document.body.classList.add("galgame-sidebar-resizing");

    const move = (pointer: PointerEvent) => {
      const bounds = editorGridRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const requestedWidth =
        side === "left"
          ? pointer.clientX - bounds.left
          : bounds.right - pointer.clientX;
      setSidebarWidth(side, requestedWidth);
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
    side: SidebarSide,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const delta = side === "left" ? direction * 10 : direction * -10;
    setSidebarWidth(side, sidebarWidths[side] + delta);
  };

  const resetSidebarWidth = (side: SidebarSide) => {
    const defaults = defaultSidebarWidths();
    setSidebarWidth(side, defaults[side]);
  };

  const editorGridStyle = {
    "--galgame-fragment-width": `${sidebarWidths.left}px`,
    "--galgame-preview-width": `${sidebarWidths.right}px`,
    "--galgame-stage-split": `${stageSplit}%`,
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
            <small>Galgame Workshop · Story V1</small>
          </span>
        </div>
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
          <button
            type="button"
            className="galgame-preview-launch"
            onClick={startPreview}
          >
            <Play aria-hidden /> 开始试玩
          </button>
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
          className="galgame-editor-grid"
          style={editorGridStyle}
        >
          <aside className="galgame-fragment-panel">
            <div className="galgame-panel-heading">
              <span>
                <small>STORY</small>
                <strong>故事结构</strong>
              </span>
              <button
                type="button"
                aria-label="新建 Fragment"
                onClick={addFragment}
              >
                <Plus aria-hidden /> Fragment
              </button>
            </div>
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
              <Field label="章节名称">
                <input
                  value={chapter.title}
                  onChange={(event) =>
                    replaceDocument(
                      updateFirstChapter(document, (current) => ({
                        ...current,
                        title: event.target.value,
                      })),
                    )
                  }
                />
              </Field>
            </details>
            <div className="galgame-chapter-row">
              <span>
                <ChevronDown aria-hidden />
                <strong>{chapter.title}</strong>
              </span>
              <em>{fragments.length}</em>
            </div>
            <div className="galgame-fragment-list">
              {fragments.map((fragment) => (
                <button
                  key={fragment.id}
                  type="button"
                  className={
                    selectedFragment?.id === fragment.id ? "active" : ""
                  }
                  onClick={() => selectFragment(fragment)}
                >
                  <span>
                    <GitBranch aria-hidden />
                    <strong>{fragment.title}</strong>
                  </span>
                  <span>
                    {chapter.entryFragmentId === fragment.id ? (
                      <em>入口</em>
                    ) : null}
                    <small>{fragment.blocks?.length ?? 0}</small>
                  </span>
                </button>
              ))}
            </div>
            {selectedFragment ? (
              <div className="galgame-fragment-actions">
                <button
                  type="button"
                  disabled={chapter.entryFragmentId === selectedFragment.id}
                  onClick={() =>
                    replaceDocument(
                      updateFirstChapter(document, (current) => ({
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
            ) : null}
            <footer>
              <span /> {fragments.length} 个 Fragment · 自动保存已开启
            </footer>
          </aside>

          <div
            className="galgame-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整故事结构栏宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_LIMITS.left.min}
            aria-valuemax={SIDEBAR_LIMITS.left.max}
            aria-valuenow={Math.round(sidebarWidths.left)}
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={(event) => startSidebarResize("left", event)}
            onKeyDown={(event) => resizeSidebarWithKeyboard("left", event)}
            onDoubleClick={() => resetSidebarWidth("left")}
          />

          <main className="galgame-block-panel">
            {selectedFragment ? (
              <>
                <header className="galgame-block-toolbar">
                  <div>
                    <Field label="Fragment 名称">
                      <input
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
                    </Field>
                    <small>
                      {selectedFragment.blocks?.length ?? 0} Block
                      {selectedFragment.timeline
                        ? ` · 剧情总长 ${formatMilliseconds(selectedFragment.timeline.durationMs)}`
                        : ""}
                    </small>
                  </div>
                </header>
                {timelineFragment ? (
                  <>
                    <StoryTimelineEditor
                      document={document}
                      fragment={timelineFragment}
                      selectedBlockId={
                        previewMode === "play"
                          ? playbackFollow?.blockId
                          : selectedBlockId
                      }
                      selectedGapId={
                        previewMode === "edit"
                          ? selectedTimelineGapId
                          : undefined
                      }
                      beatSelection={
                        previewMode === "play"
                          ? playbackBeatSelection
                          : beatSelection
                      }
                      onBeatSelection={(selection) => {
                        if (previewMode === "play")
                          setPlaybackBeatSelection(selection);
                        else {
                          setBeatSelection(selection);
                          setSelectedBlockId(undefined);
                          setSelectedTimelineGapId(undefined);
                          setInspectorTab("properties");
                        }
                      }}
                      readOnly={previewMode === "play"}
                      followPositionMs={
                        previewMode === "play"
                          ? playbackFollow?.positionMs
                          : undefined
                      }
                      followBlockId={
                        previewMode === "play"
                          ? playbackFollow?.blockId
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
                      onAudioLevel={setTimelineAudioLevelDb}
                      onPlayingChange={setTimelineAudioPlaying}
                      preferences={timelinePreferences}
                      onPreferencesChange={setTimelinePreferences}
                    />
                    <div
                      className="galgame-block-add galgame-playhead-add"
                      hidden={previewMode === "play"}
                    >
                      <strong>
                        在播放头添加 · {formatTimecode(timelinePreviewMs ?? 0)}
                      </strong>
                      {(
                        [
                          "scene",
                          "showCharacter",
                          "removeCharacter",
                          "narration",
                          "dialogue",
                          "branch",
                          "endChapter",
                        ] as BlockKind[]
                      ).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          disabled={terminates}
                          onClick={() => addBlock(kind)}
                        >
                          <Plus aria-hidden /> {BLOCK_LABELS[kind]}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={terminates}
                        onClick={addAllCharactersBlock}
                      >
                        <Plus aria-hidden /> 全部退场
                      </button>
                      {(["bgm", "ambient", "sfx"] as const).map((channel) => (
                        <button
                          key={channel}
                          type="button"
                          disabled={terminates}
                          onClick={() => addAudioBlock("play", channel)}
                        >
                          <Plus aria-hidden />
                          {
                            { bgm: "背景音乐", ambient: "环境音", sfx: "音效" }[
                              channel
                            ]
                          }
                        </button>
                      ))}
                      <details className="galgame-stop-audio-menu">
                        <summary>停止声音</summary>
                        <div>
                          {(["bgm", "ambient", "sfx"] as const).map(
                            (channel) => (
                              <button
                                key={channel}
                                type="button"
                                disabled={terminates}
                                onClick={() => addAudioBlock("stop", channel)}
                              >
                                停止
                                {
                                  {
                                    bgm: "背景音乐",
                                    ambient: "环境音",
                                    sfx: "音效",
                                  }[channel]
                                }
                              </button>
                            ),
                          )}
                        </div>
                      </details>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </main>

          <div
            className="galgame-stage-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整舞台与 Beat 时间轴高度"
            aria-orientation="horizontal"
            aria-valuemin={24}
            aria-valuemax={72}
            aria-valuenow={Math.round(stageSplit)}
            title="拖动调整舞台高度，双击恢复 42%"
            onPointerDown={startStageResize}
            onDoubleClick={() => setStageSplit(42)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setStageSplit((current) =>
                clamp(current + (event.key === "ArrowDown" ? 2 : -2), 24, 72),
              );
            }}
          />

          <div
            className="galgame-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整预览检查栏宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_LIMITS.right.min}
            aria-valuemax={SIDEBAR_LIMITS.right.max}
            aria-valuenow={Math.round(sidebarWidths.right)}
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={(event) => startSidebarResize("right", event)}
            onKeyDown={(event) => resizeSidebarWithKeyboard("right", event)}
            onDoubleClick={() => resetSidebarWidth("right")}
          />

          <aside className="galgame-preview-panel">
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
            </nav>
            <div
              ref={previewRef}
              tabIndex={-1}
              className="galgame-preview-focus"
            >
              <StoryPlayer
                ref={playerRef}
                document={document}
                mode={previewMode}
                editFragment={selectedFragment}
                editTimelinePositionMs={
                  previewMode === "edit" ? timelinePreviewMs : null
                }
                editAudioLevelDb={
                  previewMode === "edit" ? timelineAudioLevelDb : null
                }
                editTimelinePlaying={
                  previewMode === "edit" && timelineAudioPlaying
                }
                editBlockIndex={
                  selectedIndex != null && selectedIndex >= 0
                    ? selectedIndex
                    : undefined
                }
                editableCharacterId={editableCharacterId}
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
                onPlaybackPosition={setPlaybackFollow}
              />
            </div>
            <nav className="galgame-inspector-tabs" aria-label="Block 检查器">
              <button
                type="button"
                className={inspectorTab === "properties" ? "active" : ""}
                onClick={() => setInspectorTab("properties")}
              >
                属性
              </button>
              <button
                type="button"
                className={inspectorTab === "appearance" ? "active" : ""}
                onClick={() => setInspectorTab("appearance")}
              >
                样式
              </button>
              <button
                type="button"
                className={inspectorTab === "report" ? "active" : ""}
                onClick={() => setInspectorTab("report")}
              >
                检查
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
                    onMoveUp={() => moveSelected(-1)}
                    onMoveDown={() => moveSelected(1)}
                    onDelete={deleteSelected}
                    canMoveUp={Boolean(
                      selectedIndex != null && selectedIndex > 0,
                    )}
                    canMoveDown={Boolean(
                      selectedIndex != null &&
                      selectedIndex >= 0 &&
                      selectedIndex <
                        (selectedFragment?.blocks?.length ?? 0) - 1,
                    )}
                  />
                ) : projectedSelectedFragment ? (
                  <BeatRangeInspector
                    fragment={projectedSelectedFragment}
                    selection={beatSelection}
                    document={document}
                    onSelectBlock={(blockId) => {
                      setSelectedTimelineGapId(undefined);
                      setSelectedBlockId(blockId);
                    }}
                    onApply={applyBeatRangeResult}
                    onRequestDelete={() => setConfirmRangeDelete(true)}
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
      ) : workspace === "characters" ? (
        <CharacterWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
          onNotice={setNotice}
          focusCharacterId={focusedCharacterId}
          onLocate={(fragmentId, blockId) => {
            const fragment = fragmentById(chapter, fragmentId);
            if (fragment) selectFragment(fragment);
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : workspace === "scenes" ? (
        <SceneWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
          onNotice={setNotice}
          onLocate={(fragmentId, blockId) => {
            const fragment = fragmentById(chapter, fragmentId);
            if (fragment) selectFragment(fragment);
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : (
        <SoundWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
          onCommitDocument={commitDocument}
          onNotice={setNotice}
          onCharacter={(characterId) => {
            setFocusedCharacterId(characterId);
            setWorkspace("characters");
          }}
          onLocate={(fragmentId, blockId) => {
            const fragment = fragmentById(chapter, fragmentId);
            if (fragment) selectFragment(fragment);
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      )}

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
              const nextChapter = firstChapter(next);
              const nextFragment = nextChapter?.fragments?.find(
                (fragment) => fragment.id === nextChapter.entryFragmentId,
              );
              revisionRef.current = conflict.revision;
              documentRef.current = next;
              conflictRef.current = false;
              client.setQueryData(STORY_KEY(projectId), conflict);
              setDocument(next);
              setSelectedFragmentId(
                nextFragment?.id ?? nextChapter?.fragments?.[0]?.id ?? "main",
              );
              setSelectedBlockId(nextFragment?.blocks?.[0]?.id);
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
        open={confirmRangeDelete && Boolean(projectedSelectedFragment)}
        title="删除所选 Beat 范围？"
        description="非结构 Block 会被删除，后续 Beat 自动前移并闭合时间空隙；分支和章节结局会保留。"
        confirmLabel="删除并闭合"
        onCancel={() => setConfirmRangeDelete(false)}
        onConfirm={() => {
          setConfirmRangeDelete(false);
          if (!projectedSelectedFragment) return;
          applyBeatRangeResult(
            deleteTimelineBeatRange(
              projectedSelectedFragment,
              beatSelection.startIndex,
              beatSelection.endIndex,
            ),
          );
        }}
      />
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
