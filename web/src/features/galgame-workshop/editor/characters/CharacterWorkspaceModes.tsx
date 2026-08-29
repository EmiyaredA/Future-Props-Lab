import { Plus, Trash2 } from "lucide-react";
import type {
  GalgameProjectAsset,
  GalgameStoryCharacter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { CharacterStageSettingsWorkspace } from "@features/galgame-workshop/editor/CharacterStageSettingsWorkspace";
import { stableId } from "@features/galgame-workshop/editor/model";
import { CustomSelect } from "@shared/ui/CustomSelect";

export function CharacterStageWorkspace(props: {
  document: GalgameStoryProject;
  selectedCharacterId?: string;
  stageScopeId: string;
  projectAssets: GalgameProjectAsset[];
  portraitUpgradePreview?: {
    items: Array<{
      characterId: string;
      expressionId: string;
      status: string;
      currentHeightPercent?: number | null;
      targetHeightPercent?: number | null;
    }>;
  };
  portraitUpgradePending: boolean;
  onStageScopeId: (scopeId: string) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onNotice: (message: string) => void;
  onPreviewPortraitUpgrade: () => void;
  onApplyPortraitUpgrade: () => void;
}) {
  return (
    <CharacterStageSettingsWorkspace
      document={props.document}
      selectedCharacterId={props.selectedCharacterId}
      scopeId={props.stageScopeId}
      projectAssets={props.projectAssets}
      portraitUpgradePreview={props.portraitUpgradePreview}
      portraitUpgradePending={props.portraitUpgradePending}
      onScopeId={props.onStageScopeId}
      onDocument={props.onDocument}
      onCommitDocument={props.onCommitDocument}
      onNotice={props.onNotice}
      onPreviewPortraitUpgrade={props.onPreviewPortraitUpgrade}
      onApplyPortraitUpgrade={props.onApplyPortraitUpgrade}
    />
  );
}

export function CharacterTemplatesWorkspace({
  document,
  characters,
  onDocument,
}: {
  document: GalgameStoryProject;
  characters: GalgameStoryCharacter[];
  onDocument: (document: GalgameStoryProject) => void;
}) {
  return (
    <div className="galgame-character-global-workspace galgame-character-template-workspace">
      <header>
        <span>
          <strong>角色属性模板</strong>
          <em>{document.characterAttributeTemplates?.length ?? 0}</em>
        </span>
        <button
          type="button"
          onClick={() => {
            const id = stableId();
            onDocument({
              ...document,
              characterAttributeTemplates: [
                ...(document.characterAttributeTemplates ?? []),
                {
                  id,
                  name: `属性 ${(document.characterAttributeTemplates?.length ?? 0) + 1}`,
                  type: "string",
                  defaultValue: "",
                  description: "",
                },
              ],
              characters: characters.map((character) => ({
                ...character,
                attributes: { ...(character.attributes ?? {}), [id]: "" },
              })),
            });
          }}
        >
          <Plus aria-hidden /> 新增属性
        </button>
      </header>
      <p>
        模板决定全部角色可填写的属性结构；修改会随 Story revision 自动保存。
      </p>
      <div className="galgame-character-template-table">
        <header>
          <span>属性</span>
          <span>类型</span>
          <span>模板默认值</span>
          <span>说明</span>
          <span />
        </header>
        {(document.characterAttributeTemplates ?? []).map((attribute) => (
          <div key={attribute.id}>
            <input
              aria-label={`${attribute.name}名称`}
              value={attribute.name}
              onChange={(event) =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <CustomSelect
              ariaLabel={`${attribute.name}类型`}
              value={attribute.type}
              onChange={(value) => {
                const type = value as "string" | "number" | "boolean";
                const defaultValue =
                  type === "string" ? "" : type === "number" ? 0 : false;
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, type, defaultValue }
                      : item,
                  ),
                  characters: characters.map((character) => ({
                    ...character,
                    attributes: {
                      ...(character.attributes ?? {}),
                      [attribute.id]: defaultValue,
                    },
                  })),
                });
              }}
              options={[
                { value: "string", label: "文本" },
                { value: "number", label: "数值" },
                { value: "boolean", label: "开关" },
              ]}
            />
            {attribute.type === "boolean" ? (
              <input
                aria-label={`${attribute.name}默认值`}
                type="checkbox"
                checked={Boolean(attribute.defaultValue)}
                onChange={(event) =>
                  onDocument({
                    ...document,
                    characterAttributeTemplates: (
                      document.characterAttributeTemplates ?? []
                    ).map((item) =>
                      item.id === attribute.id
                        ? { ...item, defaultValue: event.target.checked }
                        : item,
                    ),
                  })
                }
              />
            ) : (
              <input
                aria-label={`${attribute.name}默认值`}
                type={attribute.type === "number" ? "number" : "text"}
                value={String(attribute.defaultValue)}
                onChange={(event) =>
                  onDocument({
                    ...document,
                    characterAttributeTemplates: (
                      document.characterAttributeTemplates ?? []
                    ).map((item) =>
                      item.id === attribute.id
                        ? {
                            ...item,
                            defaultValue:
                              attribute.type === "number"
                                ? Number(event.target.value)
                                : event.target.value,
                          }
                        : item,
                    ),
                  })
                }
              />
            )}
            <input
              aria-label={`${attribute.name}说明`}
              placeholder="属性用途说明"
              value={attribute.description ?? ""}
              onChange={(event) =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).map((item) =>
                    item.id === attribute.id
                      ? { ...item, description: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <button
              type="button"
              className="danger"
              aria-label={`删除属性 ${attribute.name}`}
              onClick={() =>
                onDocument({
                  ...document,
                  characterAttributeTemplates: (
                    document.characterAttributeTemplates ?? []
                  ).filter((item) => item.id !== attribute.id),
                  characters: characters.map((character) => {
                    const attributes = { ...(character.attributes ?? {}) };
                    delete attributes[attribute.id];
                    return { ...character, attributes };
                  }),
                })
              }
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        ))}
        {!document.characterAttributeTemplates?.length ? (
          <div className="galgame-character-template-empty">
            <strong>还没有角色属性模板</strong>
            <span>新增模板后，每个角色都可以填写对应的属性值。</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
