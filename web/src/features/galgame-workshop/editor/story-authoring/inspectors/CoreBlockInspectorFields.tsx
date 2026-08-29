import { CustomSelect } from "@shared/ui/CustomSelect";
import type { GalgameStoryBlock } from "@features/galgame-workshop/api";
import {
  CharacterTransformFields,
  CharacterTransitionFields,
} from "@features/galgame-workshop/editor/CharacterStageControls";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import { suggestCharacterPresentation } from "@features/galgame-workshop/editor/characterPresentation";
import { CgOverlayTransformFields } from "@features/galgame-workshop/editor/CgStageControls";
import {
  cgOverlay,
  DEFAULT_CG_OVERLAY,
} from "@features/galgame-workshop/editor/stage";
import { StageCastInspectorFields } from "@features/galgame-workshop/editor/StageCastInspectorFields";
import { SceneTransitionInspector } from "@features/galgame-workshop/editor/SceneTransitionInspector";
import {
  AnimateSpriteInspectorFields,
  CameraInspectorFields,
} from "@features/galgame-workshop/editor/MotionInspectorFields";
import {
  CgTransitionFields,
  Field,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function CoreBlockInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, document, patch, presentationStage } = model;
  return (
    <>
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
          <SceneTransitionInspector block={block} patch={patch} />
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
    </>
  );
}
