import { CustomSelect } from "@shared/ui/CustomSelect";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function FlowBlockInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, chapter, fragmentId, patch } = model;
  if (block.type === "branch")
    return (
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
    );
  if (block.type === "endChapter")
    return (
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
    );
  if (block.type === "returnToEntry")
    return (
      <p className="galgame-inspector-note">
        试玩到这里会清空变量、舞台与持续媒体状态，并从入口章重新开始。
      </p>
    );
  return null;
}
