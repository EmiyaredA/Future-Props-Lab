import { Check, FileImage, Plus, Trash2 } from "lucide-react";
import { stableId } from "@features/galgame-workshop/editor/model";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/CharacterWorkspaceView";
export function CharacterSkinPanel({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    selectedSkinId,
    setSelectedSkinId,
    selectedCharacter,
    selectedSkin,
    updateCharacter,
  } = model;
  return (
    <section className="galgame-portrait-skins">
      {(selectedCharacter.portraitSkins ?? []).length ? (
        <>
          <header>
            <span>
              <strong>立绘皮肤</strong>
              <small>为同一组表情配置替代素材</small>
            </span>
            <button
              type="button"
              onClick={() => {
                const id = stableId();
                updateCharacter(selectedCharacter.id, (character) => ({
                  ...character,
                  portraitSkins: [
                    ...(character.portraitSkins ?? []),
                    {
                      id,
                      name: `皮肤 ${(character.portraitSkins?.length ?? 0) + 1}`,
                      overrides: [],
                    },
                  ],
                }));
                setSelectedSkinId(id);
              }}
            >
              <Plus aria-hidden /> 添加皮肤
            </button>
          </header>
          <div className="galgame-portrait-skin-layout">
            <nav aria-label="立绘皮肤列表">
              {(selectedCharacter.portraitSkins ?? []).map((skin) => (
                <button
                  key={skin.id}
                  type="button"
                  className={selectedSkinId === skin.id ? "active" : ""}
                  onClick={() => setSelectedSkinId(skin.id)}
                >
                  <span>
                    <strong>{skin.name}</strong>
                    <small>{skin.overrides?.length ?? 0} 个替代素材</small>
                  </span>
                  {selectedCharacter.defaultPortraitSkinId === skin.id ? (
                    <em>默认</em>
                  ) : null}
                </button>
              ))}
            </nav>
            {selectedSkin ? (
              <section className="galgame-portrait-skin-editor">
                <label className="galgame-field">
                  <span>皮肤名称</span>
                  <input
                    aria-label="皮肤名称"
                    value={selectedSkin.name}
                    onChange={(event) =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        portraitSkins: (character.portraitSkins ?? []).map(
                          (item) =>
                            item.id === selectedSkin.id
                              ? {
                                  ...item,
                                  name: event.target.value,
                                }
                              : item,
                        ),
                      }))
                    }
                  />
                </label>
                <div className="galgame-portrait-skin-overrides">
                  {(selectedCharacter.expressions ?? []).map((expression) => (
                    <label key={expression.id}>
                      <span>{expression.label}</span>
                      <CustomSelect
                        ariaLabel={`${expression.label}皮肤素材`}
                        value={
                          selectedSkin.overrides?.find(
                            (item) => item.expressionId === expression.id,
                          )?.assetId ?? ""
                        }
                        onChange={(value) =>
                          updateCharacter(
                            selectedCharacter.id,
                            (character) => ({
                              ...character,
                              portraitSkins: (
                                character.portraitSkins ?? []
                              ).map((item) => {
                                if (item.id !== selectedSkin.id) return item;
                                const overrides = (item.overrides ?? []).filter(
                                  (override) =>
                                    override.expressionId !== expression.id,
                                );
                                return {
                                  ...item,
                                  overrides: value
                                    ? [
                                        ...overrides,
                                        {
                                          expressionId: expression.id,
                                          assetId: value,
                                        },
                                      ]
                                    : overrides,
                                };
                              }),
                            }),
                          )
                        }
                        options={[
                          {
                            value: "",
                            label: "跟随原始表情",
                          },
                          ...(selectedCharacter.expressions ?? []).map(
                            (source) => ({
                              value: source.assetId,
                              label: `使用 ${source.label} 素材`,
                            }),
                          ),
                        ]}
                      />
                    </label>
                  ))}
                </div>
                <footer>
                  <button
                    type="button"
                    disabled={
                      selectedCharacter.defaultPortraitSkinId ===
                      selectedSkin.id
                    }
                    onClick={() =>
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        defaultPortraitSkinId: selectedSkin.id,
                      }))
                    }
                  >
                    <Check aria-hidden /> 设为默认
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      const remaining = (
                        selectedCharacter.portraitSkins ?? []
                      ).filter((item) => item.id !== selectedSkin.id);
                      updateCharacter(selectedCharacter.id, (character) => ({
                        ...character,
                        portraitSkins: remaining,
                        defaultPortraitSkinId:
                          character.defaultPortraitSkinId === selectedSkin.id
                            ? null
                            : character.defaultPortraitSkinId,
                      }));
                      setSelectedSkinId(remaining[0]?.id);
                    }}
                  >
                    <Trash2 aria-hidden /> 删除皮肤
                  </button>
                </footer>
              </section>
            ) : (
              <div className="galgame-character-tab-empty">
                选择一个皮肤查看详情
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="galgame-portrait-skin-empty">
          <FileImage aria-hidden />
          <strong>让立绘在不同外观之间切换</strong>
          <p>为服装、受伤或季节等外观建立皮肤，并为需要替换的表情指定素材。</p>
          <button
            type="button"
            onClick={() => {
              const id = stableId();
              updateCharacter(selectedCharacter.id, (character) => ({
                ...character,
                portraitSkins: [
                  {
                    id,
                    name: "皮肤 1",
                    overrides: [],
                  },
                ],
              }));
              setSelectedSkinId(id);
            }}
          >
            <Plus aria-hidden /> 添加皮肤
          </button>
        </div>
      )}
    </section>
  );
}
