import { Plus } from "lucide-react";
import type { PetConfig, PetDocument, PetReaction } from "./api";
import { PetPicker } from "./PetPicker";

const WHALE_MOTIONS = [
  "stand",
  "jump",
  "hop",
  "look",
  "turn",
  "nod",
  "shake",
  "spin",
  "sit",
  "sleep",
  "dizzy",
  "walk",
  "run",
];
const WHALE_EXPRESSIONS = [
  "neutral",
  "happy",
  "wink",
  "love",
  "shy",
  "surprised",
  "angry",
  "sad",
  "sleepy",
  "thinking",
];

type DialogueTab = "events" | "lines" | "chat" | "look" | "habits" | "preview";

export function DialogueInspector({
  tab,
  eventLabel,
  reaction,
  whale,
  draft,
  config,
  readOnly,
  editReaction,
  edit,
}: {
  tab: DialogueTab;
  eventLabel: string | undefined;
  reaction: PetReaction;
  whale: boolean;
  draft: PetDocument;
  config: PetConfig;
  readOnly: boolean;
  editReaction: (patch: Partial<PetReaction>) => void;
  edit: (update: (value: PetConfig) => PetConfig) => void;
}) {
  return (
    <>
      {tab === "events" && (
        <>
          <div className="dp-panel-heading">
            <strong>{eventLabel}</strong>
            <small>事件属性</small>
          </div>
          <PetPicker
            label="动作"
            value={reaction.motionId ?? ""}
            options={[
              { value: "", label: "无动作" },
              ...(whale
                ? WHALE_MOTIONS.map((id) => ({ value: id, label: id }))
                : (draft.character?.motions ?? []).map((motion) => ({
                    value: motion.id,
                    label: motion.name,
                  }))),
            ]}
            onChange={(value) => editReaction({ motionId: value || null })}
            disabled={readOnly}
          />
          <PetPicker
            label="表情"
            value={reaction.expressionId ?? ""}
            options={[
              { value: "", label: "无表情" },
              ...(whale
                ? WHALE_EXPRESSIONS.map((id) => ({
                    value: id,
                    label: id,
                  }))
                : (draft.character?.expressions ?? []).map((expression) => ({
                    value: expression.id,
                    label: expression.name,
                  }))),
            ]}
            onChange={(value) => editReaction({ expressionId: value || null })}
            disabled={readOnly}
          />
          <PetPicker
            label="音效"
            value={reaction.sound}
            options={[
              { value: "none", label: "无音效" },
              { value: "tap", label: "轻点" },
              { value: "chime", label: "提示音" },
            ]}
            onChange={(value) =>
              editReaction({ sound: value as PetReaction["sound"] })
            }
            disabled={readOnly}
          />
          <div className="dp-hint">
            动作与表情并行播放，事件结束自动回到待机。音效是内置提示音，不执行脚本。
          </div>
        </>
      )}
      {tab === "lines" && (
        <>
          <div className="dp-panel-heading">
            <strong>{eventLabel}台词</strong>
            <small>最多 8 句</small>
          </div>
          {(reaction.lines ?? []).map((line, index) => (
            <div className="dp-line-row" key={index}>
              <input
                aria-label={`第 ${index + 1} 句台词`}
                disabled={readOnly}
                maxLength={140}
                value={line}
                onChange={(event) =>
                  editReaction({
                    lines: (reaction.lines ?? []).map((item, position) =>
                      position === index ? event.target.value : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                disabled={readOnly}
                aria-label={`删除第 ${index + 1} 句台词`}
                onClick={() =>
                  editReaction({
                    lines: (reaction.lines ?? []).filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="dp-side-action"
            type="button"
            disabled={readOnly || (reaction.lines?.length ?? 0) >= 8}
            onClick={() =>
              editReaction({ lines: [...(reaction.lines ?? []), ""] })
            }
          >
            <Plus size={15} />
            添加台词
          </button>
          <p className="dp-hint">
            每句 1–140 字；触发时轮换，避免连续重复。待机台词只会低频出现。
          </p>
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="dp-panel-heading">
            <strong>角色人设</strong>
          </div>
          {(
            [
              ["description", "角色简介", 500],
              ["personality", "性格", 500],
              ["speakingStyle", "说话方式", 500],
              ["greeting", "开场白", 140],
            ] as const
          ).map(([key, label, maxLength]) => (
            <label className="dp-field" key={key}>
              <span>{label}</span>
              <textarea
                disabled={readOnly}
                maxLength={maxLength}
                value={config.persona?.[key] ?? ""}
                onChange={(event) =>
                  edit((value) => ({
                    ...value,
                    persona: {
                      description: "",
                      personality: "",
                      speakingStyle: "",
                      greeting: "",
                      ...value.persona,
                      [key]: event.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
          <p className="dp-hint">
            开场白在聊天小窗首次打开时显示；私人的模型选择与聊天记录不会写进这个角色配置。
          </p>
        </>
      )}
    </>
  );
}
