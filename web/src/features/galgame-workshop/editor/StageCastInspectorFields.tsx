import { Plus, Sparkles, Trash2, Users } from "lucide-react";
import { useId } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type {
  GalgameStoryProject,
  GalgameStorySetStageCastBlock,
  GalgameStoryStageCastMember,
} from "@features/galgame-workshop/api";
import {
  CharacterTransformFields,
  CharacterTransitionFields,
} from "@features/galgame-workshop/editor/CharacterStageControls";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import {
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
} from "@features/galgame-workshop/editor/stage";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";

const MAX_STAGE_CAST_MEMBERS = 8;

function defaultMember(
  document: GalgameStoryProject,
  characterId: string,
): GalgameStoryStageCastMember {
  const settings = characterStageSettings(document, characterId);
  const position =
    settings.positionPresets.find(
      (candidate) => candidate.id === settings.defaultPositionId,
    ) ?? settings.positionPresets[0];
  return {
    characterId,
    expressionId: null,
    skinId: null,
    distance: "medium",
    positionId: position?.id ?? null,
    transform: {
      ...DEFAULT_CHARACTER_TRANSFORM,
      x: position?.x ?? 50,
      y: position?.y ?? 100,
      anchor: settings.anchor,
      scale: settings.legacyDefaultScale ?? 1,
    },
    transition: DEFAULT_CHARACTER_TRANSITION,
  };
}

export function StageCastInspectorFields({
  block,
  document,
  onChange,
}: {
  block: GalgameStorySetStageCastBlock;
  document: GalgameStoryProject;
  onChange: (block: GalgameStorySetStageCastBlock) => void;
}) {
  const exitTransitionHeadingId = useId();
  const members = block.members ?? [];
  const updateMember = (
    index: number,
    update: (
      member: GalgameStoryStageCastMember,
    ) => GalgameStoryStageCastMember,
  ) =>
    onChange({
      ...block,
      members: members.map((member, memberIndex) =>
        memberIndex === index ? update(member) : member,
      ),
    });
  const usedIds = new Set(members.map((member) => member.characterId));
  const availableCharacter = (document.characters ?? []).find(
    (character) => !usedIds.has(character.id),
  );

  return (
    <div className="galgame-stage-cast-inspector">
      {members.length === 0 ? (
        <div className="galgame-stage-cast-empty">
          <span className="galgame-stage-cast-empty-icon">
            <Users aria-hidden />
          </span>
          <span>
            <strong>舞台暂时留空</strong>
            <small>播放到这里时，会清空画面中的全部角色。</small>
          </span>
        </div>
      ) : (
        <div className="galgame-stage-cast-summary">
          <span>舞台角色</span>
          <strong>
            {members.length} / {MAX_STAGE_CAST_MEMBERS}
          </strong>
        </div>
      )}
      <div className="galgame-stage-cast-list">
        {members.map((member, index) => {
          const character = (document.characters ?? []).find(
            (candidate) => candidate.id === member.characterId,
          );
          const settings = characterStageSettings(document, member.characterId);
          return (
            <section
              key={`${member.characterId}:${index}`}
              className="galgame-stage-cast-member"
            >
              <header>
                <span>
                  <strong>角色 {index + 1}</strong>
                  <small>{character?.name ?? "未命名角色"}</small>
                </span>
                <button
                  type="button"
                  aria-label={`移除构图角色 ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...block,
                      members: members.filter(
                        (_, memberIndex) => memberIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </button>
              </header>
              <Field label="角色">
                <CustomSelect
                  ariaLabel={`构图角色 ${index + 1}`}
                  value={member.characterId}
                  options={(document.characters ?? [])
                    .filter(
                      (candidate) =>
                        candidate.id === member.characterId ||
                        !usedIds.has(candidate.id),
                    )
                    .map((candidate) => ({
                      value: candidate.id,
                      label: candidate.name,
                    }))}
                  onChange={(characterId) =>
                    updateMember(index, () =>
                      defaultMember(document, characterId),
                    )
                  }
                />
              </Field>
              <Field label="表情与皮肤">
                <div className="galgame-character-presentation-fields">
                  <CustomSelect
                    ariaLabel={`构图角色 ${index + 1} 表情`}
                    value={member.expressionId ?? ""}
                    options={[
                      { value: "", label: "默认表情" },
                      ...(character?.expressions ?? []).map((expression) => ({
                        value: expression.id,
                        label: expression.label,
                      })),
                    ]}
                    onChange={(expressionId) =>
                      updateMember(index, (current) => ({
                        ...current,
                        expressionId: expressionId || null,
                      }))
                    }
                  />
                  <CustomSelect
                    ariaLabel={`构图角色 ${index + 1} 皮肤`}
                    value={member.skinId ?? ""}
                    options={[
                      { value: "", label: "默认皮肤" },
                      ...(character?.portraitSkins ?? []).map((skin) => ({
                        value: skin.id,
                        label: skin.name,
                      })),
                    ]}
                    onChange={(skinId) =>
                      updateMember(index, (current) => ({
                        ...current,
                        skinId: skinId || null,
                      }))
                    }
                  />
                </div>
              </Field>
              <Field label="人物呈现">
                <div className="galgame-character-presentation-fields">
                  <CustomSelect
                    ariaLabel={`构图角色 ${index + 1} 距离`}
                    value={member.distance}
                    options={[
                      { value: "far", label: "远景" },
                      { value: "medium", label: "中景" },
                      { value: "near", label: "近景" },
                    ]}
                    onChange={(distance) =>
                      updateMember(index, (current) => ({
                        ...current,
                        distance: distance as "far" | "medium" | "near",
                      }))
                    }
                  />
                  <CustomSelect
                    ariaLabel={`构图角色 ${index + 1} 位置`}
                    value={member.positionId ?? settings.defaultPositionId}
                    options={settings.positionPresets.map((preset) => ({
                      value: preset.id,
                      label: preset.name,
                    }))}
                    onChange={(positionId) =>
                      updateMember(index, (current) => ({
                        ...current,
                        positionId,
                      }))
                    }
                  />
                </div>
              </Field>
              <CharacterTransformFields
                transform={member.transform}
                transition={member.transition}
                onTransform={(transform) =>
                  updateMember(index, (current) => ({ ...current, transform }))
                }
                onTransition={(transition) =>
                  updateMember(index, (current) => ({ ...current, transition }))
                }
              />
            </section>
          );
        })}
      </div>
      {members.length < MAX_STAGE_CAST_MEMBERS && availableCharacter ? (
        <button
          type="button"
          className="galgame-stage-cast-add"
          aria-label="添加舞台角色"
          onClick={() =>
            onChange({
              ...block,
              members: [
                ...members,
                defaultMember(document, availableCharacter.id),
              ],
            })
          }
        >
          <span className="galgame-stage-cast-add-icon">
            <Plus aria-hidden />
          </span>
          <span className="galgame-stage-cast-add-copy">
            <strong>添加舞台角色</strong>
            <small>把角色加入当前构图</small>
          </span>
          <span className="galgame-stage-cast-add-count">
            <small>还可添加</small>
            <strong>{MAX_STAGE_CAST_MEMBERS - members.length}</strong>
            <small>人</small>
          </span>
        </button>
      ) : null}
      <section
        className="galgame-stage-exit-card"
        aria-labelledby={exitTransitionHeadingId}
      >
        <header>
          <span className="galgame-stage-exit-icon">
            <Sparkles aria-hidden />
          </span>
          <span>
            <strong id={exitTransitionHeadingId}>退场动效</strong>
            <small>应用于未保留在新构图中的角色</small>
          </span>
        </header>
        <CharacterTransitionFields
          transition={block.exitTransition}
          fadeLabel="淡出离场"
          fadeDescription="让角色自然离开画面"
          onChange={(exitTransition) => onChange({ ...block, exitTransition })}
        />
      </section>
    </div>
  );
}
