import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  getCodexSource,
  restoreCodexSource,
  updateCodexSource,
  type CodexSourceState,
} from "@features/tools/api";
import "@features/tools/codex-model-source.css";

const SOURCE_KEY = ["codex-model-source"] as const;
type PendingAction = "apply" | "restore" | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请刷新后重试。";
}

export function CodexModelSourcePage({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const sourceQuery = useQuery({
    queryKey: SOURCE_KEY,
    queryFn: getCodexSource,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [source, setSource] = useState<"openai" | "custom">("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [envKey, setEnvKey] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const current = sourceQuery.data;
    if (!current) return;
    setSource(current.managed ? "custom" : "openai");
    if (current.managed) {
      setModel(current.model);
      setBaseUrl(current.base_url);
      setEnvKey(current.env_key);
    }
  }, [sourceQuery.data]);

  const mutation = useMutation({
    mutationFn: async (action: Exclude<PendingAction, null>) => {
      const current = sourceQuery.data;
      if (!current) throw new Error("请先读取 Codex 配置");
      return action === "restore"
        ? restoreCodexSource(current.revision)
        : updateCodexSource({
            expected_revision: current.revision,
            source,
            model: model.trim(),
            base_url: baseUrl.trim(),
            env_key: envKey.trim(),
          });
    },
    onSuccess: (next: CodexSourceState, action) => {
      queryClient.setQueryData(SOURCE_KEY, next);
      setPendingAction(null);
      setError("");
      setNotice(
        action === "restore"
          ? "已恢复首次切换前的 Codex 配置。请重启 Codex，并在新会话中检查模型。"
          : "已更新本机 Codex 配置。请重启 Codex；已有会话需自行选择模型。",
      );
    },
    onError: (failure) => {
      setPendingAction(null);
      setError(errorMessage(failure));
      void sourceQuery.refetch();
    },
  });

  const current = sourceQuery.data;
  const canApply = Boolean(
    current &&
    (source === "openai" || (model.trim() && baseUrl.trim())) &&
    !mutation.isPending,
  );

  return (
    <section className="page codex-source-page">
      <button className="codex-source-back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden /> 返回工具
      </button>
      <header className="codex-source-header">
        <span className="codex-source-mark">
          <Settings2 aria-hidden />
        </span>
        <div>
          <h1>Codex 模型源</h1>
          <p>管理这台电脑上 Codex 的默认模型供应商。</p>
        </div>
      </header>

      {sourceQuery.isLoading ? (
        <LoadingState label="正在读取本机 Codex 配置…" variant="region" />
      ) : null}
      {sourceQuery.isError ? (
        <div className="codex-source-message error" role="alert">
          <strong>无法读取本机配置</strong>
          <span>{errorMessage(sourceQuery.error)}</span>
          <button type="button" onClick={() => void sourceQuery.refetch()}>
            重试
          </button>
        </div>
      ) : null}

      {current ? (
        <>
          <div className="codex-source-layout">
            <main className="codex-source-panel">
              <div className="codex-source-panel-head">
                <h2>切换模型源</h2>
                <button
                  type="button"
                  onClick={() => void sourceQuery.refetch()}
                  aria-label="刷新 Codex 配置"
                >
                  <RefreshCw aria-hidden /> 刷新
                </button>
              </div>
              <div
                className="codex-source-choices"
                role="group"
                aria-label="选择 Codex 模型源"
              >
                <button
                  type="button"
                  className={source === "openai" ? "active" : ""}
                  aria-pressed={source === "openai"}
                  onClick={() => setSource("openai")}
                >
                  OpenAI 官方
                </button>
                <button
                  type="button"
                  className={source === "custom" ? "active" : ""}
                  aria-pressed={source === "custom"}
                  onClick={() => setSource("custom")}
                >
                  自定义 Responses API
                </button>
              </div>

              {source === "custom" ? (
                <div className="codex-source-fields">
                  <label htmlFor="codex-source-model">模型 ID</label>
                  <input
                    id="codex-source-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="例如 my-model"
                    autoComplete="off"
                  />
                  <label htmlFor="codex-source-url">API 基础地址</label>
                  <input
                    id="codex-source-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://example.com/v1"
                    type="url"
                    autoComplete="off"
                  />
                  <label htmlFor="codex-source-env">
                    API Key 环境变量名 <span>可选</span>
                  </label>
                  <input
                    id="codex-source-env"
                    value={envKey}
                    onChange={(event) => setEnvKey(event.target.value)}
                    placeholder="MY_CODEX_API_KEY"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p>
                    需要密钥时，请在启动 Codex
                    的环境中设置此变量。这里仅保存变量名，不接收密钥明文。服务端须兼容
                    Responses API。
                  </p>
                </div>
              ) : (
                <p className="codex-source-explainer">
                  切换后使用 Codex
                  官方模型供应商。首次切换前的完整配置也可通过「恢复原始配置」取回。
                </p>
              )}

              {error ? (
                <p className="codex-source-message error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="codex-source-message success" role="status">
                  {notice}
                </p>
              ) : null}
              <div className="codex-source-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!canApply}
                  onClick={() => {
                    setNotice("");
                    setError("");
                    setPendingAction("apply");
                  }}
                >
                  应用到本机 Codex
                </button>
                <button
                  type="button"
                  disabled={!current.backup_available || mutation.isPending}
                  onClick={() => {
                    setNotice("");
                    setError("");
                    setPendingAction("restore");
                  }}
                >
                  恢复原始配置
                </button>
              </div>
            </main>

            <aside className="codex-source-panel codex-source-status">
              <div className="codex-source-panel-head">
                <h2>当前配置</h2>
                <ShieldCheck aria-hidden />
              </div>
              <dl>
                <div>
                  <dt>供应商</dt>
                  <dd>{current.provider}</dd>
                </div>
                <div>
                  <dt>默认模型</dt>
                  <dd>{current.model || "由 Codex 决定"}</dd>
                </div>
                {current.base_url ? (
                  <div>
                    <dt>API 地址</dt>
                    <dd>{current.base_url}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>配置文件</dt>
                  <dd>{current.config_path}</dd>
                </div>
              </dl>
              {current.provider !== "openai" && !current.managed ? (
                <p className="codex-source-hint">
                  当前使用其他工具设置的供应商。应用新配置前请确认你希望改变本机默认值。
                </p>
              ) : null}
              <a
                href="https://developers.openai.com/codex/config-reference"
                target="_blank"
                rel="noopener noreferrer"
              >
                Codex 官方配置参考 <ExternalLink aria-hidden />
              </a>
            </aside>
          </div>
          <ConfirmDialog
            open={pendingAction !== null}
            title={
              pendingAction === "restore"
                ? "恢复原始配置？"
                : "应用 Codex 模型源？"
            }
            description={
              pendingAction === "restore"
                ? "将用首次切换前的备份覆盖当前 config.toml。"
                : "将修改本机 Codex 的 config.toml。保存后请重启 Codex，新会话才会读取默认模型源。"
            }
            confirmLabel={pendingAction === "restore" ? "恢复配置" : "确认应用"}
            tone="primary"
            pending={mutation.isPending}
            onCancel={() => setPendingAction(null)}
            onConfirm={() => {
              if (pendingAction) mutation.mutate(pendingAction);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
