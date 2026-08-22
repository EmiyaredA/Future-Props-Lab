import { ArrowDown, ArrowUp, Clock3, Settings2, Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { type GalgameStoryBlock } from "@features/galgame-workshop/api";
import { DialogueVoiceBinding } from "@features/galgame-workshop/editor/DialogueVoiceBinding";
import {
  CharacterTransformFields,
  CharacterTransitionFields,
} from "@features/galgame-workshop/editor/CharacterStageControls";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import { suggestCharacterPresentation } from "@features/galgame-workshop/editor/characterPresentation";
import { CgOverlayTransformFields } from "@features/galgame-workshop/editor/CgStageControls";
import {
  stableId,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  cgOverlay,
  DEFAULT_CG_OVERLAY,
} from "@features/galgame-workshop/editor/stage";
import {
  attachTimelineCharacterEvent,
  formatTimecode,
  resizeTimelineCueEnd,
  setTimelineCgRangeEdge,
  setTimelineCueEdge,
  setTimelinePointTime,
} from "@features/galgame-workshop/editor/timeline";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import "@features/galgame-workshop/galgameStyles";
import { DialogueInspectorFields } from "@features/galgame-workshop/editor/DialogueInspectorFields";
import { WaitInspectorFields } from "@features/galgame-workshop/editor/WaitInspectorFields";
import { AudioInspectorFields } from "@features/galgame-workshop/editor/AudioInspectorFields";
import { CurtainInspectorFields } from "@features/galgame-workshop/editor/CurtainInspectorFields";
import { StageCastInspectorFields } from "@features/galgame-workshop/editor/StageCastInspectorFields";
import {
  AnimateSpriteInspectorFields,
  CameraInspectorFields,
} from "@features/galgame-workshop/editor/MotionInspectorFields";
import type { useBlockInspectorController } from "@features/galgame-workshop/editor/useBlockInspectorController";
import {
  BLOCK_LABELS,
  BlockTypeIcon,
  CgTransitionFields,
  Field,
  TimecodeField,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
export {
  Field,
  ChapterCast,
  FragmentOverviewInspector,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
type BlockInspectorControllerModel = ReturnType<
  typeof useBlockInspectorController
>;
export type BlockInspectorViewModel = Extract<
  BlockInspectorControllerModel,
  { status: "ready" }
>;
export function BlockInspectorView({
  model,
}: {
  model: BlockInspectorControllerModel;
}) {
  if (model.status === "empty")
    return (
      <div className="galgame-inspector-empty">
        <Settings2 aria-hidden />
        <strong>未选择 Block</strong>
        <span>在中间的剧本流中选择一个 Block 后编辑属性。</span>
      </div>
    );
  const {
    projectId,
    block,
    document,
    chapter,
    fragmentId,
    onDocument,
    onNotice,
    voiceStale,
    onVoiceFresh,
    onAutoMatchVoice,
    timelinePreferences,
    onMoveUp,
    onMoveDown,
    onDelete,
    canMoveUp,
    canMoveDown,
    patch,
    fragment,
    presentationStage,
    pointTime,
    cgRange,
    characterTiming,
    dialogueTargets,
    dialogueCharacter,
    dialogueName,
  } = model;
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
      {(block.type === "showCharacter" ||
        block.type === "setStageCast" ||
        block.type === "removeCharacter") &&
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
              onChange={(characterId) => {
                const presentation = suggestCharacterPresentation(
                  document,
                  characterId,
                  presentationStage,
                );
                patch((current) =>
                  current.type === "showCharacter"
                    ? {
                        ...current,
                        characterId,
                        expressionId: null,
                        ...presentation,
                      }
                    : current,
                );
              }}
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
          <Field label="人物呈现">
            <div className="galgame-character-presentation-fields">
              <CustomSelect
                ariaLabel="角色距离"
                value={block.distance ?? "medium"}
                options={[
                  { value: "far", label: "远景" },
                  { value: "medium", label: "中景" },
                  { value: "near", label: "近景" },
                ]}
                onChange={(distance) =>
                  patch((current) =>
                    current.type === "showCharacter"
                      ? {
                          ...current,
                          distance: distance as "far" | "medium" | "near",
                        }
                      : current,
                  )
                }
              />
              <CustomSelect
                ariaLabel="角色位置预设"
                value={
                  block.positionId ??
                  characterStageSettings(document, block.characterId)
                    .defaultPositionId
                }
                options={characterStageSettings(
                  document,
                  block.characterId,
                ).positionPresets.map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                }))}
                onChange={(positionId) =>
                  patch((current) =>
                    current.type === "showCharacter"
                      ? { ...current, positionId }
                      : current,
                  )
                }
              />
            </div>
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
      ) : block.type === "setStageCast" ? (
        <StageCastInspectorFields
          block={block}
          document={document}
          onChange={(nextBlock) =>
            patch((current) =>
              current.type === "setStageCast" ? nextBlock : current,
            )
          }
        />
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
      ) : block.type === "camera" ? (
        <CameraInspectorFields
          block={block}
          onChange={(nextBlock) =>
            patch((current) =>
              current.type === "camera" ? nextBlock : current,
            )
          }
        />
      ) : block.type === "animateSprite" ? (
        <AnimateSpriteInspectorFields
          block={block}
          document={document}
          onChange={(nextBlock) =>
            patch((current) =>
              current.type === "animateSprite" ? nextBlock : current,
            )
          }
        />
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
                    {
                      value: "",
                      label: dialogueCharacter?.defaultDisplayNameId
                        ? "跟随角色默认显示名"
                        : "角色主名称",
                    },
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
              <small>
                未单独指定时跟随角色默认显示名；逐句选择只覆盖这句对白。
              </small>
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
          <DialogueInspectorFields model={model} />
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
        <WaitInspectorFields model={model} />
      ) : block.type === "audio" ? (
        <AudioInspectorFields model={model} />
      ) : block.type === "curtain" ? (
        <CurtainInspectorFields model={model} />
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
