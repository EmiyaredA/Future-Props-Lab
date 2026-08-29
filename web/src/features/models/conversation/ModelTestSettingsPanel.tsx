import { useEffect, useState, type CSSProperties } from "react";
import { Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import type {
  ModelTestConversation,
  ModelTestToolSummary,
} from "@features/models/api";
import { ModelTestToolSelector } from "@features/models/conversation/ModelTestToolControls";

export type ModelTestConversationPatch = Partial<
  Pick<
    ModelTestConversation,
    "title" | "model_id" | "system_prompt" | "temperature" | "max_tokens"
  >
> & { tool_ids?: string[] };

export function ModelTestSettingsPanel({
  open,
  conversation,
  tools,
  toolsSupported,
  disabled,
  onPatch,
  onClose,
}: {
  open: boolean;
  conversation: ModelTestConversation | undefined;
  tools: ModelTestToolSummary[];
  toolsSupported: boolean;
  disabled: boolean;
  onPatch: (changes: ModelTestConversationPatch) => Promise<void>;
  onClose: () => void;
}) {
  const [temperature, setTemperature] = useState(
    conversation?.temperature ?? 0.7,
  );
  useEffect(() => {
    setTemperature(conversation?.temperature ?? 0.7);
  }, [conversation?.id, conversation?.revision, conversation?.temperature]);
  return (
    <aside className={`settings-panel${open ? " mobile-open" : ""}`}>
      <div className="panel-heading settings-heading">
        <div className="settings-heading-copy">
          <span>
            <SlidersHorizontal aria-hidden />
            <strong>测试参数</strong>
          </span>
          <small>调整当前会话的生成方式</small>
        </div>
      </div>
      {conversation ? (
        <div className="settings-form">
          <label className="parameter-field">
            <span className="parameter-label">
              系统提示词 <em className="optional-badge">可选</em>
            </span>
            <textarea
              key={`${conversation.id}-system-${conversation.revision}`}
              defaultValue={conversation.system_prompt}
              rows={7}
              disabled={disabled}
              placeholder="可选，用于定义模型角色和回答要求"
              onBlur={(event) => {
                if (event.target.value !== conversation.system_prompt)
                  void onPatch({ system_prompt: event.target.value });
              }}
            />
          </label>
          <ModelTestToolSelector
            selected={tools}
            supported={toolsSupported}
            disabled={disabled}
            onSave={async (toolIds) => onPatch({ tool_ids: toolIds })}
          />
          <label className="parameter-field temperature-field">
            <span className="parameter-label">
              Temperature
              <output className="temperature-value">
                {temperature.toFixed(1)}
              </output>
            </span>
            <div className="temperature-control">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                disabled={disabled}
                style={
                  {
                    "--range-progress": `${(temperature / 2) * 100}%`,
                  } as CSSProperties
                }
                onChange={(event) => setTemperature(Number(event.target.value))}
                onPointerUp={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (value !== conversation.temperature)
                    void onPatch({ temperature: value });
                }}
                onKeyUp={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (value !== conversation.temperature)
                    void onPatch({ temperature: value });
                }}
              />
              <div className="range-scale" aria-hidden="true">
                <span>精确</span>
                <span>平衡</span>
                <span>创意</span>
              </div>
            </div>
            <small className="parameter-help">
              较低的值更稳定，较高的值更有创造性。
            </small>
          </label>
          <label className="parameter-field">
            <span className="parameter-label">最大输出</span>
            <div className="token-input">
              <input
                type="number"
                min="1"
                max="8192"
                key={`${conversation.id}-tokens-${conversation.max_tokens}`}
                defaultValue={conversation.max_tokens}
                disabled={disabled}
                onBlur={(event) => {
                  const value = Math.min(
                    8192,
                    Math.max(1, Number(event.target.value)),
                  );
                  if (value !== conversation.max_tokens)
                    void onPatch({ max_tokens: value });
                }}
              />
              <span>Token</span>
            </div>
          </label>
          <div className="parameter-note">
            <Info aria-hidden />
            <div>
              <strong>上下文策略</strong>
              <p>
                仅已成功完成的轮次及其图片会进入下一次请求；失败或停止的回复只保留展示。
              </p>
            </div>
          </div>
          <button
            type="button"
            className="reset-parameters"
            disabled={disabled}
            onClick={() => {
              setTemperature(0.7);
              void onPatch({
                system_prompt: "",
                temperature: 0.7,
                max_tokens: 1024,
              });
            }}
          >
            <RotateCcw aria-hidden /> 恢复默认参数
          </button>
        </div>
      ) : null}
      <button className="mobile-panel-close" onClick={onClose}>
        收起
      </button>
    </aside>
  );
}
