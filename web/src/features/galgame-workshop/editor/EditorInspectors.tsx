import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Clock3,
  Flag,
  GitBranch,
  Images,
  MapPinned,
  MessageSquareText,
  Music2,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import {
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryCgTransition,
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
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  BLOCK_REGISTRY,
  CURTAIN_MODE_OPTIONS,
  WAIT_DURATION_PRESETS,
} from "@features/galgame-workshop/editor/blockRegistry";
import type { TimelinePreferences } from "@features/galgame-workshop/editor/timelinePreferences";
import {
  stableId,
  type BlockKind,
  updateBlock,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  cgOverlay,
  DEFAULT_CG_OVERLAY,
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
} from "@features/galgame-workshop/editor/stage";
import {
  attachTimelineCharacterEvent,
  effectivePointTime,
  formatTimecode,
  parseTimecode,
  resizeTimelineCueEnd,
  setTimelineCgRangeEdge,
  setTimelineCueEdge,
  setTimelineGapEdge,
  setTimelinePointTime,
  timelineCgRanges,
  timelineCharacterTiming,
  type GalgameTimelineGap,
} from "@features/galgame-workshop/editor/timeline";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  dialogueDisplayName,
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";

const BLOCK_LABELS = Object.fromEntries(
  Object.entries(BLOCK_REGISTRY).map(([type, capability]) => [
    type,
    capability.label,
  ]),
) as Record<BlockKind, string>;

const AUDIO_INSPECTOR_CHANNELS = [
  {
    value: "bgm",
    label: "背景音乐",
    code: "BGM",
    role: "backgroundMusic",
  },
  { value: "sfx", label: "音效", code: "SE", role: "soundEffect" },
  {
    value: "ambient",
    label: "环境音",
    code: "AMBIENT",
    role: "ambientSound",
  },
] as const;

type AudioInspectorChannel = (typeof AUDIO_INSPECTOR_CHANNELS)[number]["value"];

function audioInspectorRole(channel: AudioInspectorChannel) {
  return AUDIO_INSPECTOR_CHANNELS.find((option) => option.value === channel)!
    .role;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
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

export function ChapterCast({
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

export function FragmentOverviewInspector({
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
export function BlockInspector({
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
  onAutoMatchVoice,
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
  onAutoMatchVoice: (blockId: string) => Promise<boolean>;
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
  const dialogueCharacter =
    block.type === "dialogue"
      ? (document.characters ?? []).find(
          (character) => character.id === block.characterId,
        )
      : undefined;
  const dialogueName =
    block.type === "dialogue"
      ? dialogueDisplayName(
          dialogueCharacter,
          block.displayNameId,
          Object.fromEntries(
            (document.variables ?? []).map((variable) => [
              variable.id,
              variable.defaultValue,
            ]),
          ),
        )
      : undefined;

  return (
    <div className="galgame-block-inspector">
      <header>
        <span className={`galgame-block-kind is-${block.type}`}>
          <BlockTypeIcon type={block.type} />
        </span>
        <span>
          <strong>
            {block.type === "dialogue"
              ? `对白 · ${dialogueName}`
              : BLOCK_LABELS[block.type]}
          </strong>
          {block.type === "dialogue" ? null : <small>{block.id}</small>}
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
      {(block.type === "narration" ||
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
              autoFocus={false}
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
          <section className="galgame-dialogue-primary-settings">
            <div className="galgame-dialogue-display-name-field">
              <span>显示名</span>
              <div>
                <output aria-label="当前对白显示名">{dialogueName}</output>
                <CustomSelect
                  ariaLabel="对白显示名方案"
                  value={block.displayNameId ?? ""}
                  options={[
                    { value: "", label: "主名称" },
                    ...(dialogueCharacter?.displayNames ?? []).map((item) => ({
                      value: item.id,
                      label: item.label,
                    })),
                  ]}
                  onChange={(displayNameId) =>
                    patch((current) =>
                      current.type === "dialogue"
                        ? { ...current, displayNameId: displayNameId || null }
                        : current,
                    )
                  }
                />
              </div>
              <small>仅改变这句对白显示的名字；角色、立绘与配音不变。</small>
            </div>
            <DialogueVoiceBinding
              projectId={projectId}
              document={document}
              fragmentId={fragmentId}
              block={block}
              stale={voiceStale}
              onDocument={onDocument}
              onFresh={onVoiceFresh}
              onNotice={onNotice}
              onAutoMatchVoice={onAutoMatchVoice}
            />
          </section>
          <details className="galgame-dialogue-advanced-settings">
            <summary>高级设置</summary>
            <div>
              {block.startMs != null && block.endMs != null ? (
                <div className="galgame-block-timing" aria-label="对白时间范围">
                  <header>
                    <Clock3 aria-hidden />
                    <span>
                      <strong>剧情时间轴</strong>
                      <small>
                        时长 {formatTimecode(block.endMs - block.startMs)}
                      </small>
                    </span>
                  </header>
                  <div>
                    <TimecodeField
                      label="对白开始时间"
                      value={block.startMs}
                      onCommit={(milliseconds) =>
                        onDocument(
                          updateFragment(document, fragmentId, (current) =>
                            setTimelineCueEdge(
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
                      label="对白结束时间"
                      value={block.endMs}
                      onCommit={(milliseconds) =>
                        onDocument(
                          updateFragment(document, fragmentId, (current) =>
                            resizeTimelineCueEnd(
                              current,
                              block.id,
                              milliseconds,
                              {
                                precise: true,
                                ripple: timelinePreferences.ripple,
                                keepContinuous: true,
                              },
                            ),
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              ) : null}
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
                              const currentSpeakers =
                                dialogueSpeakerIds(current);
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
                              const currentSpeakers =
                                dialogueSpeakerIds(current);
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
                    const defaultExpression = (
                      character?.expressions ?? []
                    ).find(
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
              <div className="galgame-field">
                <span>对白正文</span>
                <RichTextEditor
                  autoFocus={false}
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
                        ? {
                            ...current,
                            content,
                            text: richTextPlainText(content),
                          }
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
                      if (mode === "legacy")
                        return { ...current, portrait: null };
                      return {
                        ...current,
                        portrait: {
                          mode: mode as
                            "stage" | "dialogueAvatar" | "soloLegacy",
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
                        ? {
                            ...current,
                            hideDialogueAfter: event.target.checked,
                          }
                        : current,
                    )
                  }
                />
                <span>本句后隐藏对话框（┘）</span>
              </label>
            </div>
          </details>
        </>
      ) : block.type === "storyParagraph" ? (
        <>
          <Field label="段落正文">
            <RichTextEditor
              autoFocus={false}
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
        <div className="galgame-wait-inspector">
          <section>
            <span>模式</span>
            <div
              className="galgame-inspector-segments"
              role="group"
              aria-label="等待模式"
            >
              <button
                type="button"
                className={block.mode === "duration" ? "active" : ""}
                aria-pressed={block.mode === "duration"}
                onClick={() =>
                  patch((current) =>
                    current.type === "wait"
                      ? {
                          ...current,
                          mode: "duration",
                          durationMs: current.durationMs ?? 1000,
                        }
                      : current,
                  )
                }
              >
                等待指定时间
              </button>
              <button
                type="button"
                className={block.mode === "player" ? "active" : ""}
                aria-pressed={block.mode === "player"}
                onClick={() =>
                  patch((current) =>
                    current.type === "wait"
                      ? { ...current, mode: "player", durationMs: null }
                      : current,
                  )
                }
              >
                等待玩家继续
              </button>
            </div>
          </section>
          {block.mode === "duration" ? (
            <>
              <label className="galgame-inspector-number-row">
                <span>时长</span>
                <div>
                  <input
                    aria-label="等待时长"
                    type="number"
                    min="0"
                    max="3600000"
                    value={block.durationMs ?? 1000}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "wait"
                          ? {
                              ...current,
                              durationMs: Math.min(
                                3600000,
                                Math.max(0, Number(event.target.value)),
                              ),
                            }
                          : current,
                      )
                    }
                  />
                  <em>ms</em>
                </div>
              </label>
              <section>
                <span>预设</span>
                <div className="galgame-wait-presets">
                  {WAIT_DURATION_PRESETS.map((durationMs) => (
                    <button
                      key={durationMs}
                      type="button"
                      className={
                        block.durationMs === durationMs ? "active" : ""
                      }
                      onClick={() =>
                        patch((current) =>
                          current.type === "wait"
                            ? { ...current, durationMs }
                            : current,
                        )
                      }
                    >
                      {durationMs}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      patch((current) =>
                        current.type === "wait"
                          ? { ...current, mode: "player", durationMs: null }
                          : current,
                      )
                    }
                  >
                    等待玩家继续
                  </button>
                </div>
              </section>
            </>
          ) : (
            <p className="galgame-inspector-note">
              自动播放和跳过模式都不会越过此 Block，必须由玩家继续。
            </p>
          )}
        </div>
      ) : block.type === "audio" ? (
        <div className="galgame-audio-inspector">
          <div className="galgame-audio-inspector-section">
            <span className="galgame-audio-inspector-label">动作</span>
            <div
              className="galgame-audio-action-tabs"
              role="group"
              aria-label="声音动作"
            >
              {[
                { value: "play", label: "播放 / 切换" },
                { value: "stop", label: "停止通道" },
              ].map((action) => {
                const disabled =
                  action.value === "play" &&
                  block.action === "stop" &&
                  !(document.assets ?? []).some(
                    (asset) =>
                      asset.type === "audio" &&
                      asset.role === audioInspectorRole(block.channel),
                  );
                return (
                  <button
                    key={action.value}
                    type="button"
                    className={block.action === action.value ? "active" : ""}
                    aria-pressed={block.action === action.value}
                    disabled={disabled}
                    onClick={() =>
                      patch((current) => {
                        if (current.type !== "audio") return current;
                        if (action.value === "stop")
                          return { ...current, action: "stop", assetId: null };
                        const asset = (document.assets ?? []).find(
                          (candidate) =>
                            candidate.type === "audio" &&
                            candidate.role ===
                              audioInspectorRole(current.channel),
                        );
                        return asset
                          ? {
                              ...current,
                              action: "play",
                              assetId: asset.id,
                            }
                          : current;
                      })
                    }
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="galgame-audio-inspector-section">
            <span className="galgame-audio-inspector-label">类型</span>
            <div
              className="galgame-audio-type-tabs"
              role="group"
              aria-label="声音类型"
            >
              {AUDIO_INSPECTOR_CHANNELS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={block.channel === option.value ? "active" : ""}
                  aria-pressed={block.channel === option.value}
                  onClick={() =>
                    patch((current) => {
                      if (current.type !== "audio") return current;
                      const nextChannel = option.value;
                      const defaults =
                        nextChannel === "sfx"
                          ? { volume: 100, loop: false, fadeMs: 0 }
                          : { volume: 70, loop: true, fadeMs: 1000 };
                      const asset = (document.assets ?? []).find(
                        (candidate) =>
                          candidate.type === "audio" &&
                          candidate.role === option.role,
                      );
                      return {
                        ...current,
                        channel: nextChannel,
                        assetId:
                          current.action === "play"
                            ? (asset?.id ?? null)
                            : null,
                        ...defaults,
                      };
                    })
                  }
                >
                  <span>{option.label}</span>
                  <small>{option.code}</small>
                </button>
              ))}
            </div>
          </div>
          {block.action === "play" ? (
            <Field label="声音素材">
              <CustomSelect
                ariaLabel="声音素材"
                value={block.assetId ?? ""}
                options={[
                  {
                    value: "",
                    label: "点击选择音频文件…",
                    disabled: true,
                  },
                  ...(document.assets ?? [])
                    .filter(
                      (asset) =>
                        asset.type === "audio" &&
                        asset.role === audioInspectorRole(block.channel),
                    )
                    .map((asset) => ({
                      value: asset.id,
                      label: asset.type === "audio" ? asset.label : "未知声音",
                    })),
                ]}
                onChange={(assetId) =>
                  patch((current) =>
                    current.type === "audio"
                      ? { ...current, assetId: assetId || null }
                      : current,
                  )
                }
              />
            </Field>
          ) : null}
          <Field label="音轨 ID">
            <input aria-label="音轨 ID" value={block.channel} readOnly />
            <small className="galgame-audio-track-hint">
              同一音轨的新声音会替换当前声音，停止指令也按此音轨生效。
            </small>
          </Field>
          {block.action === "play" ? (
            <>
              <label className="galgame-audio-control-row">
                <span>音量</span>
                <div>
                  <input
                    aria-label="播放音量"
                    className="galgame-audio-number"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={block.volume}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "audio"
                          ? {
                              ...current,
                              volume: Math.min(
                                100,
                                Math.max(0, Number(event.target.value)),
                              ),
                            }
                          : current,
                      )
                    }
                  />
                  <em>%</em>
                  <input
                    aria-label="播放音量滑杆"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={block.volume}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "audio"
                          ? { ...current, volume: Number(event.target.value) }
                          : current,
                      )
                    }
                  />
                </div>
              </label>
              <label className="galgame-audio-switch">
                <span>循环播放</span>
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
                <i aria-hidden />
              </label>
              <label className="galgame-audio-control-row">
                <span>淡入时长</span>
                <div>
                  <input
                    aria-label="淡入时间"
                    className="galgame-audio-number"
                    type="number"
                    min="0"
                    max="10000"
                    step="100"
                    value={block.fadeMs}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "audio"
                          ? {
                              ...current,
                              fadeMs: Math.min(
                                10000,
                                Math.max(0, Number(event.target.value)),
                              ),
                            }
                          : current,
                      )
                    }
                  />
                  <em>ms</em>
                  <input
                    aria-label="淡入时间滑杆"
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
                </div>
              </label>
            </>
          ) : (
            <label className="galgame-audio-control-row">
              <span>淡出时长</span>
              <div>
                <input
                  aria-label="淡出时间"
                  className="galgame-audio-number"
                  type="number"
                  min="0"
                  max="10000"
                  step="100"
                  value={block.fadeMs}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "audio"
                        ? {
                            ...current,
                            fadeMs: Math.min(
                              10000,
                              Math.max(0, Number(event.target.value)),
                            ),
                          }
                        : current,
                    )
                  }
                />
                <em>ms</em>
                <input
                  aria-label="淡出时间滑杆"
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
              </div>
            </label>
          )}
        </div>
      ) : block.type === "curtain" ? (
        <div className="galgame-curtain-inspector">
          <section>
            <span>模式</span>
            <div
              className="galgame-inspector-segments is-four"
              role="group"
              aria-label="幕布模式"
            >
              {CURTAIN_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={block.mode === option.value ? "active" : ""}
                  aria-pressed={block.mode === option.value}
                  onClick={() =>
                    patch((current) =>
                      current.type === "curtain"
                        ? { ...current, mode: option.value }
                        : current,
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>动作</span>
            <div
              className="galgame-inspector-segments"
              role="group"
              aria-label="幕布动作"
            >
              <button
                type="button"
                className={block.action === "show" ? "active" : ""}
                aria-pressed={block.action === "show"}
                onClick={() =>
                  patch((current) =>
                    current.type === "curtain"
                      ? { ...current, action: "show" }
                      : current,
                  )
                }
              >
                合上（屏幕变暗）
              </button>
              <button
                type="button"
                className={block.action === "hide" ? "active" : ""}
                aria-pressed={block.action === "hide"}
                onClick={() =>
                  patch((current) =>
                    current.type === "curtain"
                      ? { ...current, action: "hide" }
                      : current,
                  )
                }
              >
                打开（屏幕显露）
              </button>
            </div>
          </section>
          <label className="galgame-inspector-range-row">
            <span>时长</span>
            <div>
              <span>
                <input
                  aria-label="幕布动画时长"
                  type="number"
                  min="0"
                  max="60000"
                  step="100"
                  value={block.durationMs}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "curtain"
                        ? {
                            ...current,
                            durationMs: Math.min(
                              60000,
                              Math.max(0, Number(event.target.value)),
                            ),
                          }
                        : current,
                    )
                  }
                />
                <em>ms</em>
              </span>
              <input
                aria-label="幕布动画时长滑杆"
                type="range"
                min="0"
                max="60000"
                step="100"
                value={block.durationMs}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "curtain"
                      ? { ...current, durationMs: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </div>
          </label>
          <label className="galgame-curtain-color-row">
            <span>颜色</span>
            <CustomColorPicker
              ariaLabel="幕布颜色"
              value={block.color}
              onChange={(color) =>
                patch((current) =>
                  current.type === "curtain" ? { ...current, color } : current,
                )
              }
            />
          </label>
          <label className="galgame-inspector-range-row">
            <span>不透明度</span>
            <div>
              <output>{Math.round(block.opacity * 100)}%</output>
              <input
                aria-label="幕布不透明度"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={block.opacity}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "curtain"
                      ? { ...current, opacity: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </div>
          </label>
          <label className="galgame-inspector-check-row">
            <input
              type="checkbox"
              checked={block.waitForCompletion}
              onChange={(event) =>
                patch((current) =>
                  current.type === "curtain"
                    ? {
                        ...current,
                        waitForCompletion: event.target.checked,
                      }
                    : current,
                )
              }
            />
            <span>等待动画完成后继续</span>
          </label>
        </div>
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

export function TimelineGapInspector({
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
