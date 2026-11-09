import { Send, Square } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { useAmadeusController } from "./useAmadeusController";

type ModelControls = Pick<
  ReturnType<typeof useAmadeusController>,
  | "agents"
  | "agentId"
  | "setAgentId"
  | "models"
  | "modelCatalog"
  | "modelId"
  | "setModelId"
  | "modelVariants"
  | "modelVariant"
  | "setModelVariant"
  | "harnessEfforts"
  | "harnessEffort"
  | "harnessCatalogStatus"
  | "setHarnessEffort"
  | "fastAvailable"
  | "fast"
  | "setFast"
  | "reasoningEfforts"
  | "reasoningEffort"
  | "setReasoningEffort"
  | "busy"
  | "detail"
  | "create"
  | "setError"
  | "stop"
  | "importing"
  | "send"
>;

export function ComposerModels({ controls }: { controls: ModelControls }) {
  const {
    agents,
    agentId,
    setAgentId,
    models,
    modelCatalog,
    modelId,
    setModelId,
    modelVariants,
    modelVariant,
    setModelVariant,
    harnessEfforts,
    harnessEffort,
    harnessCatalogStatus,
    setHarnessEffort,
    fastAvailable,
    fast,
    setFast,
    reasoningEfforts,
    reasoningEffort,
    setReasoningEffort,
    busy,
    detail,
    create,
    setError,
    stop,
    send,
    importing,
  } = controls;
  return (
    <div className="amadeus-composer-models">
      <div className="amadeus-toolbar-run">
        <div className="amadeus-model-choices">
          <div className="amadeus-model-control">
            <CustomSelect
              ariaLabel="选择 Code Agent"
              value={agentId}
              disabled={busy}
              options={agents.map((item) => ({
                value: item.id,
                label: item.name,
                description: item.message,
                disabled: !item.available,
              }))}
              onChange={(value) => {
                if (value === agentId) return;
                const change = () => {
                  setAgentId(value);
                  setModelId("default");
                };
                if (detail?.conversation.agent_id)
                  void create()
                    .then(change)
                    .catch((cause) => setError(String(cause)));
                else change();
              }}
            />
          </div>
          <div className="amadeus-model-control">
            <CustomSelect
              ariaLabel="选择模型"
              value={modelId}
              disabled={busy}
              options={models.map((item) => ({
                value: item.id,
                label: item.label,
                description:
                  item.id === "default" && modelCatalog === "unavailable"
                    ? "模型目录读取失败，可继续使用 CLI 默认模型"
                    : item.id !== "default" && modelCatalog === "preset"
                      ? "CLI 模型预设，实际可用性取决于登录账号"
                      : undefined,
              }))}
              onChange={setModelId}
            />
          </div>
          {reasoningEfforts?.length > 0 && (
            <div className="amadeus-model-control">
              <CustomSelect
                ariaLabel="推理强度"
                value={reasoningEffort || "default"}
                disabled={busy}
                options={[
                  { value: "default", label: "默认推理强度" },
                  ...reasoningEfforts.map((value) => ({
                    value,
                    label: `推理 · ${value}`,
                  })),
                ]}
                onChange={(value) =>
                  setReasoningEffort(value === "default" ? "" : value)
                }
              />
            </div>
          )}
          <TurnOptionSelect
            label="模型变体"
            value={modelVariant}
            choices={modelVariants}
            onChange={setModelVariant}
            disabled={busy}
          />
          <TurnOptionSelect
            label="Harness 推理档位"
            value={harnessEffort}
            choices={harnessEfforts}
            onChange={setHarnessEffort}
            disabled={busy}
          />
          <TurnOptionSelect
            label="Codex 服务档位"
            defaultLabel="CLI 默认档位"
            value={fast ? "fast" : ""}
            choices={fastAvailable ? [{ id: "fast", label: "快档" }] : []}
            onChange={(value) => setFast(value === "fast")}
            disabled={busy}
          />
        </div>
        <button
          type="button"
          className="amadeus-send"
          title={busy ? "停止" : "发送"}
          aria-label={busy ? "停止" : "发送"}
          disabled={importing && !busy}
          onClick={() => (busy ? stop() : void send())}
        >
          {busy ? (
            <Square size={16} aria-hidden />
          ) : (
            <Send size={16} aria-hidden />
          )}
        </button>
      </div>
      {harnessCatalogStatus === "unavailable" && (
        <small className="amadeus-model-status" role="status">
          Harness 推理档位暂不可用，可使用 CLI 默认档位
        </small>
      )}
      {modelCatalog === "unavailable" && (
        <small className="amadeus-model-status" role="status">
          模型目录暂不可用
        </small>
      )}
    </div>
  );
}

function TurnOptionSelect({
  label,
  defaultLabel = `默认${label}`,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  defaultLabel?: string;
  value: string;
  choices: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  if (!choices.length && !value) return null;
  return (
    <div className="amadeus-model-control">
      <CustomSelect
        ariaLabel={label}
        value={value ? `option:${value}` : "default"}
        disabled={disabled}
        options={[
          { value: "default", label: defaultLabel },
          ...choices.map((option) => ({
            value: `option:${option.id}`,
            label: option.label,
          })),
          ...(value && !choices.some((option) => option.id === value)
            ? [
                {
                  value: `option:${value}`,
                  label: `${value} · 不可用`,
                  disabled: true,
                },
              ]
            : []),
        ]}
        onChange={(next) =>
          onChange(next === "default" ? "" : next.slice("option:".length))
        }
      />
    </div>
  );
}
