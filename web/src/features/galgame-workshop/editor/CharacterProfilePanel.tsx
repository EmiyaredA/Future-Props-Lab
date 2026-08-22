import { Check, Plus, RotateCcw, Trash2, UserRound } from "lucide-react";
import { stableId } from "@features/galgame-workshop/editor/model";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/characterWorkspaceViewModel";
import { CHARACTER_PALETTE } from "@features/galgame-workshop/editor/characterWorkspacePresentation";
export function CharacterProfilePanel({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    document,
    selectedDisplayNameId,
    setSelectedDisplayNameId,
    tab,
    setWorkspaceMode,
    selectedCharacter,
    selectedExpression,
    selectedDisplayName,
    updateCharacter,
  } = model;
  return (
    <div
      className={`galgame-character-base-form is-${tab} ${
        tab === "displayNames"
          ? selectedDisplayNameId === "main"
            ? "is-main"
            : "is-scheme"
          : ""
      }`}
    >
      {tab === "displayNames" ? (
        <section className="galgame-display-name-browser">
          <header>
            <span>
              <strong>可用名字</strong>
              <small>选择后在下方编辑</small>
            </span>
            <div>
              <button
                type="button"
                onClick={() => {
                  const id = stableId();
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    displayNames: [
                      ...(character.displayNames ?? []),
                      {
                        id,
                        label: `别名 ${(character.displayNames?.length ?? 0) + 1}`,
                        source: "literal",
                        value: character.name,
                        variableId: null,
                      },
                    ],
                  }));
                  setSelectedDisplayNameId(id);
                }}
              >
                <Plus aria-hidden /> 别名
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = stableId();
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    displayNames: [
                      ...(character.displayNames ?? []),
                      {
                        id,
                        label: `变量值 ${(character.displayNames?.length ?? 0) + 1}`,
                        source: "variable",
                        value: null,
                        variableId:
                          document.variables?.find(
                            (variable) => variable.type === "string",
                          )?.id ?? null,
                      },
                    ],
                  }));
                  setSelectedDisplayNameId(id);
                }}
              >
                <span aria-hidden>#</span> 变量值
              </button>
            </div>
          </header>
          <div>
            <button
              type="button"
              className={selectedDisplayNameId === "main" ? "active" : ""}
              onClick={() => setSelectedDisplayNameId("main")}
            >
              <span>
                <UserRound aria-hidden />
                <small>主名称</small>
              </span>
              <strong>{selectedCharacter.name}</strong>
              <Check aria-hidden />
            </button>
            {(selectedCharacter.displayNames ?? []).map((scheme) => (
              <button
                key={scheme.id}
                type="button"
                className={selectedDisplayNameId === scheme.id ? "active" : ""}
                onClick={() => setSelectedDisplayNameId(scheme.id)}
              >
                <span>
                  <span aria-hidden>#</span>
                  <small>{scheme.label}</small>
                </span>
                <strong>
                  {scheme.source === "literal"
                    ? scheme.value || "未填写"
                    : scheme.source === "variable"
                      ? "字符串变量"
                      : "角色属性"}
                </strong>
                {selectedCharacter.defaultDisplayNameId === scheme.id ? (
                  <em>默认</em>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <label className="galgame-field">
        <span>角色名称</span>
        <input
          value={selectedCharacter.name}
          onChange={(event) =>
            updateCharacter(selectedCharacter.id, (character) => ({
              ...character,
              name: event.target.value,
            }))
          }
        />
      </label>
      <label className="galgame-field">
        <span>设定说明</span>
        <textarea
          value={selectedCharacter.description}
          onChange={(event) =>
            updateCharacter(selectedCharacter.id, (character) => ({
              ...character,
              description: event.target.value,
            }))
          }
        />
      </label>
      <label className="galgame-field">
        <span>角色 ID（只读）</span>
        <input value={selectedCharacter.id} readOnly />
      </label>
      <label className="galgame-field galgame-character-theme-field">
        <span>角色主题色</span>
        <CustomColorPicker
          ariaLabel="角色主题色"
          value={selectedCharacter.themeColor ?? "#E75B55"}
          colors={CHARACTER_PALETTE}
          onChange={(value) =>
            updateCharacter(selectedCharacter.id, (character) => ({
              ...character,
              themeColor: value,
            }))
          }
        />
      </label>
      <section className="galgame-character-official-settings galgame-display-name-editor">
        <header>
          <span>
            <strong>{selectedDisplayName?.label ?? "显示名方案"}</strong>
            <small>设置对白中实际显示的角色名称</small>
          </span>
          {selectedDisplayName ? (
            <button
              type="button"
              disabled={
                selectedCharacter.defaultDisplayNameId ===
                selectedDisplayName.id
              }
              onClick={() => {
                updateCharacter(selectedCharacter.id, (character) => ({
                  ...character,
                  defaultDisplayNameId: selectedDisplayName.id,
                }));
              }}
            >
              <Check aria-hidden /> 设为默认
            </button>
          ) : null}
        </header>
        {(selectedCharacter.displayNames ?? [])
          .filter((scheme) => scheme.id === selectedDisplayNameId)
          .map((scheme) => (
            <div key={scheme.id} className="galgame-display-name-row">
              <input
                aria-label="显示名方案名称"
                value={scheme.label}
                onChange={(event) =>
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    displayNames: (character.displayNames ?? []).map((item) =>
                      item.id === scheme.id
                        ? { ...item, label: event.target.value }
                        : item,
                    ),
                  }))
                }
              />
              <CustomSelect
                ariaLabel="显示名来源"
                value={scheme.source}
                onChange={(value) =>
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    displayNames: (character.displayNames ?? []).map((item) =>
                      item.id === scheme.id
                        ? value === "variable"
                          ? {
                              ...item,
                              source: "variable",
                              value: null,
                              attributeId: null,
                              variableId:
                                document.variables?.find(
                                  (variable) => variable.type === "string",
                                )?.id ?? null,
                            }
                          : value === "attribute"
                            ? {
                                ...item,
                                source: "attribute",
                                value: null,
                                variableId: null,
                                attributeId:
                                  document.characterAttributeTemplates?.find(
                                    (attribute) => attribute.type === "string",
                                  )?.id ?? null,
                              }
                            : {
                                ...item,
                                source: "literal",
                                value: selectedCharacter.name,
                                variableId: null,
                                attributeId: null,
                              }
                        : item,
                    ),
                  }))
                }
                options={[
                  { value: "literal", label: "固定名称" },
                  { value: "variable", label: "字符串变量" },
                  { value: "attribute", label: "角色属性" },
                ]}
              />
              {scheme.source === "variable" ? (
                <CustomSelect
                  ariaLabel="显示名变量"
                  value={scheme.variableId ?? ""}
                  onChange={(value) =>
                    updateCharacter(selectedCharacter.id, (character) => ({
                      ...character,
                      displayNames: (character.displayNames ?? []).map(
                        (item) =>
                          item.id === scheme.id
                            ? {
                                ...item,
                                variableId: value || null,
                              }
                            : item,
                      ),
                    }))
                  }
                  options={[
                    { value: "", label: "选择变量" },
                    ...(document.variables ?? [])
                      .filter((variable) => variable.type === "string")
                      .map((variable) => ({
                        value: variable.id,
                        label: variable.name,
                      })),
                  ]}
                />
              ) : scheme.source === "attribute" ? (
                <CustomSelect
                  ariaLabel="显示名角色属性"
                  value={scheme.attributeId ?? ""}
                  onChange={(value) =>
                    updateCharacter(selectedCharacter.id, (character) => ({
                      ...character,
                      displayNames: (character.displayNames ?? []).map(
                        (item) =>
                          item.id === scheme.id
                            ? {
                                ...item,
                                attributeId: value || null,
                              }
                            : item,
                      ),
                    }))
                  }
                  options={[
                    { value: "", label: "选择属性" },
                    ...(document.characterAttributeTemplates ?? [])
                      .filter((attribute) => attribute.type === "string")
                      .map((attribute) => ({
                        value: attribute.id,
                        label: attribute.name,
                      })),
                  ]}
                />
              ) : (
                <input
                  aria-label="固定显示名"
                  value={scheme.value ?? ""}
                  onChange={(event) =>
                    updateCharacter(selectedCharacter.id, (character) => ({
                      ...character,
                      displayNames: (character.displayNames ?? []).map(
                        (item) =>
                          item.id === scheme.id
                            ? { ...item, value: event.target.value }
                            : item,
                      ),
                    }))
                  }
                />
              )}
              <button
                type="button"
                className="danger"
                aria-label={`删除显示名 ${scheme.label}`}
                onClick={() => {
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    displayNames: (character.displayNames ?? []).filter(
                      (item) => item.id !== scheme.id,
                    ),
                    defaultDisplayNameId:
                      character.defaultDisplayNameId === scheme.id
                        ? null
                        : character.defaultDisplayNameId,
                  }));
                  setSelectedDisplayNameId("main");
                }}
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
      </section>
      <section className="galgame-character-official-settings galgame-character-dialogue-avatar-settings">
        <header>
          <strong>仅对白头像</strong>
        </header>
        <label className="galgame-stage-checkbox">
          <input
            type="checkbox"
            checked={selectedCharacter.dialogueAvatar?.enabled ?? false}
            onChange={(event) =>
              updateCharacter(selectedCharacter.id, (character) => ({
                ...character,
                dialogueAvatar: {
                  enabled: event.target.checked,
                },
              }))
            }
          />
          <span>允许对白使用头像模式</span>
        </label>
        <div className="galgame-avatar-crop-grid">
          {(["x", "y", "scale"] as const).map((key) => (
            <label key={key}>
              <span>
                {key === "scale" ? "缩放" : `裁切 ${key.toUpperCase()}`}
              </span>
              <input
                type="number"
                min={key === "scale" ? 0.5 : 0}
                max={key === "scale" ? 6 : 100}
                step={key === "scale" ? 0.1 : 1}
                value={
                  selectedExpression?.dialogueAvatar?.crop?.[key] ??
                  { x: 50, y: 25, scale: 1.8 }[key]
                }
                onChange={(event) =>
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    expressions: (character.expressions ?? []).map(
                      (expression) =>
                        expression.id === selectedExpression?.id
                          ? {
                              ...expression,
                              dialogueAvatar: {
                                ...(expression.dialogueAvatar ?? {
                                  source: "portrait" as const,
                                  crop: {
                                    x: 50,
                                    y: 25,
                                    scale: 1.8,
                                  },
                                }),
                                crop: {
                                  ...(expression.dialogueAvatar?.crop ?? {
                                    x: 50,
                                    y: 25,
                                    scale: 1.8,
                                  }),
                                  [key]: Number(event.target.value),
                                },
                              },
                            }
                          : expression,
                    ),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </section>
      <section className="galgame-character-attributes">
        <header>
          <span>
            <strong>角色属性</strong>
            <small>{selectedCharacter.name} · 当前角色覆盖值</small>
          </span>
          <div>
            <button
              type="button"
              onClick={() =>
                updateCharacter(selectedCharacter.id, (character) => ({
                  ...character,
                  attributes: Object.fromEntries(
                    (document.characterAttributeTemplates ?? []).map(
                      (attribute) => [attribute.id, attribute.defaultValue],
                    ),
                  ),
                }))
              }
            >
              <RotateCcw aria-hidden /> 恢复默认
            </button>
            <button type="button" onClick={() => setWorkspaceMode("templates")}>
              管理属性
            </button>
          </div>
        </header>
        <p>属性结构由全局模板统一维护；这里仅覆盖当前角色的默认值。</p>
        {(document.characterAttributeTemplates ?? []).map((attribute) => (
          <div key={attribute.id}>
            <span>
              <strong>
                {attribute.name} <em>{attribute.type}</em>
              </strong>
              <small>{attribute.description || attribute.type}</small>
            </span>
            {attribute.type === "boolean" ? (
              <input
                aria-label={`${attribute.name}值`}
                type="checkbox"
                checked={Boolean(selectedCharacter.attributes?.[attribute.id])}
                onChange={(event) =>
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    attributes: {
                      ...(character.attributes ?? {}),
                      [attribute.id]: event.target.checked,
                    },
                  }))
                }
              />
            ) : (
              <input
                aria-label={`${attribute.name}值`}
                type={attribute.type === "number" ? "number" : "text"}
                value={String(
                  selectedCharacter.attributes?.[attribute.id] ??
                    attribute.defaultValue,
                )}
                onChange={(event) =>
                  updateCharacter(selectedCharacter.id, (character) => ({
                    ...character,
                    attributes: {
                      ...(character.attributes ?? {}),
                      [attribute.id]:
                        attribute.type === "number"
                          ? Number(event.target.value)
                          : event.target.value,
                    },
                  }))
                }
              />
            )}
            <button
              type="button"
              onClick={() =>
                updateCharacter(selectedCharacter.id, (character) => {
                  const attributes = {
                    ...(character.attributes ?? {}),
                  };
                  delete attributes[attribute.id];
                  return { ...character, attributes };
                })
              }
            >
              清除
            </button>
          </div>
        ))}
        {!document.characterAttributeTemplates?.length ? (
          <div className="galgame-character-attribute-empty">
            还没有属性模板，请先前往全局设置创建。
          </div>
        ) : null}
      </section>
      <small>修改将在 650ms 后自动保存。</small>
    </div>
  );
}
