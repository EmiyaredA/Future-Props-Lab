import { ImageIcon, SlidersHorizontal, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
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
  | "codexImageGeneration"
  | "setCodexImageGeneration"
  | "mode"
  | "setFast"
  | "reasoningEfforts"
  | "reasoningEffort"
  | "setReasoningEffort"
  | "busy"
  | "detail"
  | "create"
  | "setError"
>;

export function ComposerModels({
  controls,
  writable = true,
}: {
  controls: ModelControls;
  writable?: boolean;
}) {
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
    codexImageGeneration,
    setCodexImageGeneration,
    mode,
    setFast,
    reasoningEfforts,
    reasoningEffort,
    setReasoningEffort,
    busy,
    detail,
    create,
    setError,
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
          {(agentId === "codex" ||
            reasoningEfforts?.length > 0 ||
            modelVariants.length > 0 ||
            harnessEfforts.length > 0 ||
            fastAvailable ||
            modelVariant ||
            harnessEffort ||
            fast) && (
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="amadeus-run-options"
                  aria-label="运行设置"
                  title="运行设置"
                >
                  <SlidersHorizontal size={15} aria-hidden />
                  <span>
                    {[
                      reasoningEffort,
                      modelVariant,
                      harnessEffort,
                      fast ? "快档" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "运行设置"}
                  </span>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="amadeus-files-overlay" />
                <Dialog.Content className="amadeus-run-settings">
                  <header>
                    <Dialog.Title>运行设置</Dialog.Title>
                    <Dialog.Close aria-label="关闭运行设置">
                      <X size={17} aria-hidden />
                    </Dialog.Close>
                  </header>
                  <Dialog.Description>
                    {busy ? "当前运行的设置已固定。" : "设置将用于下一次运行。"}
                  </Dialog.Description>
                  <div className="amadeus-run-settings-fields">
                    {agentId === "codex" && (
                      <div className="amadeus-image-setting">
                        <button
                          type="button"
                          role="switch"
                          aria-label="Codex 生图"
                          aria-checked={codexImageGeneration}
                          className="amadeus-image-toggle"
                          disabled={busy || mode === "plan" || !writable}
                          onClick={() =>
                            setCodexImageGeneration(!codexImageGeneration)
                          }
                        >
                          <ImageIcon size={15} aria-hidden />
                          Codex 生图 · {codexImageGeneration ? "开启" : "关闭"}
                        </button>
                        <small>
                          {mode === "plan"
                            ? "Plan 模式不生成图片"
                            : !writable
                              ? "当前账号没有生图所需的写权限"
                              : "使用 Codex 自带生图，生成后自动保存到当前会话。"}
                        </small>
                      </div>
                    )}
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
                      choices={
                        fastAvailable ? [{ id: "fast", label: "快档" }] : []
                      }
                      onChange={(value) => setFast(value === "fast")}
                      disabled={busy}
                    />
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </div>
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
