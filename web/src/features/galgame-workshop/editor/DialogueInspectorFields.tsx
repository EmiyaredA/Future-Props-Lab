import { Clock3 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  CharacterTransformFields,
  CharacterTransitionFields,
} from "@features/galgame-workshop/editor/CharacterStageControls";
import { suggestCharacterPresentation } from "@features/galgame-workshop/editor/characterPresentation";
import {
  dialogueSpeakerIds,
  withDialogueSpeakers,
} from "@features/galgame-workshop/editor/dialogue";
import { updateFragment } from "@features/galgame-workshop/editor/model";
import {
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
} from "@features/galgame-workshop/editor/stage";
import {
  formatTimecode,
  resizeTimelineCueEnd,
  setTimelineCueEdge,
} from "@features/galgame-workshop/editor/timeline";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/InspectorFieldControls";
import {
  Field,
  TimecodeField,
} from "@features/galgame-workshop/editor/InspectorFieldControls";
export function DialogueInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const {
    block,
    document,
    fragmentId,
    onDocument,
    onVoiceStale,
    timelinePreferences,
    patch,
    presentationStage,
  } = model;
  if (
    !block ||
    block.type !== "dialogue" ||
    !document ||
    !fragmentId ||
    !onDocument ||
    !onVoiceStale ||
    !timelinePreferences ||
    !patch
  )
    return null;
  return (
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
                      resizeTimelineCueEnd(current, block.id, milliseconds, {
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
        <Field label="说话角色">
          <CustomSelect
            ariaLabel="说话角色"
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
                current.type === "dialogue"
                  ? (() => {
                      const currentSpeakers = dialogueSpeakerIds(current);
                      const nextSpeakers =
                        currentSpeakers.length === 1
                          ? [characterId]
                          : currentSpeakers.includes(characterId)
                            ? [
                                characterId,
                                ...currentSpeakers.filter(
                                  (speakerId) => speakerId !== characterId,
                                ),
                              ]
                            : [characterId, ...currentSpeakers.slice(1)];
                      const updated = withDialogueSpeakers(
                        current,
                        nextSpeakers,
                      );
                      return {
                        ...updated,
                        portrait: updated.portrait
                          ? {
                              ...updated.portrait,
                              ...presentation,
                              transform: null,
                            }
                          : updated.portrait,
                      };
                    })()
                  : current,
              );
            }}
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
                  <span>为这句对白自定义亮度、透明度与层级</span>
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
  );
}
