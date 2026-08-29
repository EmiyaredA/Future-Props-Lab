import { CustomSelect } from "@shared/ui/CustomSelect";
import { DialogueVoiceBinding } from "@features/galgame-workshop/editor/DialogueVoiceBinding";
import { DialogueInspectorFields } from "@features/galgame-workshop/editor/DialogueInspectorFields";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";
import { RichTextEditor } from "@features/galgame-workshop/editor/RichTextEditor";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function TextBlockInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const {
    projectId,
    block,
    document,
    fragmentId,
    onDocument,
    onNotice,
    voiceStale,
    onVoiceFresh,
    onAutoMatchVoice,
    patch,
    dialogueCharacter,
    dialogueName,
  } = model;
  if (block.type === "narration")
    return (
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
    );
  if (block.type === "dialogue")
    return (
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
    );
  if (block.type === "storyParagraph")
    return (
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
    );
  return null;
}
