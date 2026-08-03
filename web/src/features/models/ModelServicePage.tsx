import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import {
  addModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getCatalog,
  setProviderEnabled,
  testModel,
  updateModel,
  updateProvider,
  type Catalog,
  type ModelEntry,
  type ModelInput,
  type Provider,
  type ProviderInput,
} from "@features/models/api";

type Conflict = {
  current: Catalog;
  retry: (revision: number) => Promise<unknown>;
};
type Modal =
  | { kind: "provider"; initial: Provider | null }
  | { kind: "model"; providerId: string; initial: ModelEntry | null }
  | null;

const providerKindLabel = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
} as const;
const capabilityLabel = {
  chat: "对话",
  vision: "视觉",
  tools: "工具",
} as const;

function ActionIcon({
  kind,
}: {
  kind: "edit" | "delete" | "key" | "revision";
}) {
  const paths = {
    edit: (
      <path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5ZM13 7.5l3.5 3.5M15.5 5l1.2-1.2a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L19 8.5" />
    ),
    delete: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
    key: (
      <path d="M14 9a5 5 0 1 1-1.4-3.5A5 5 0 0 1 14 9Zm0 0h7m-3 0v3m-3-3v2" />
    ),
    revision: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2" />,
  };
  return (
    <svg className="ui-action-icon" viewBox="0 0 24 24" aria-hidden>
      {paths[kind]}
    </svg>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={on ? "已启用" : "未启用"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span />
    </button>
  );
}

function ProviderForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: Provider | null;
  onCancel: () => void;
  onSave: (input: ProviderInput) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"openai" | "anthropic">(
    initial?.kind ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        kind,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        enabled: initial?.enabled ?? true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="modal-card form-stack"
      onSubmit={(event) => void submit(event)}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">模型供应商</span>
          <h2>{initial ? "编辑供应商" : "添加供应商"}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <label>
        <span>名称</span>
        <input
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：主模型网关"
        />
      </label>
      <label>
        <span>通道类型</span>
        <CustomSelect
          ariaLabel="通道类型"
          value={kind}
          onChange={(value) => setKind(value as typeof kind)}
          options={[
            { value: "openai", label: "OpenAI 兼容" },
            { value: "anthropic", label: "Anthropic" },
          ]}
        />
      </label>
      <label>
        <span>Base URL</span>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={
            kind === "openai"
              ? "https://api.openai.com/v1"
              : "https://api.anthropic.com/v1"
          }
        />
        <small>留空使用该通道的官方默认地址。</small>
      </label>
      <label>
        <span>
          API Key{" "}
          {initial?.has_api_key ? (
            <em>已配置 ····{initial.api_key_hint}，留空保留</em>
          ) : null}
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={initial?.has_api_key ? "留空不修改" : "输入 API Key"}
        />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}

function ModelForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: ModelEntry | null;
  onCancel: () => void;
  onSave: (input: ModelInput) => Promise<void>;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [capabilities, setCapabilities] = useState<
    Array<"chat" | "vision" | "tools">
  >(initial?.capabilities ?? ["chat"]);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const toggle = (value: "chat" | "vision" | "tools") =>
    setCapabilities((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        slug: slug.trim(),
        label: label.trim(),
        description: description.trim(),
        capabilities,
        enabled,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="modal-card form-stack"
      onSubmit={(event) => void submit(event)}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">模型条目</span>
          <h2>{initial ? "编辑模型" : "添加模型"}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <label>
        <span>模型标识</span>
        <input
          required
          maxLength={160}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="例如：gpt-5-mini"
        />
      </label>
      <label>
        <span>显示名称</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="可选"
        />
      </label>
      <label>
        <span>说明</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="可选，一句话说明模型用途"
        />
      </label>
      <fieldset>
        <legend>能力</legend>
        <div className="capability-picker">
          {(["chat", "vision", "tools"] as const).map((capability) => (
            <button
              type="button"
              className={capabilities.includes(capability) ? "active" : ""}
              key={capability}
              onClick={() => toggle(capability)}
            >
              {capabilityLabel[capability]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>立即启用此模型</span>
      </label>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn primary"
          disabled={busy || !slug.trim() || capabilities.length === 0}
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}

export function ModelServicePage({ onOpenLogs }: { onOpenLogs: () => void }) {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: getCatalog,
  });
  const catalog = catalogQuery.data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && catalog?.providers[0])
      setSelectedId(catalog.providers[0].id);
    if (
      selectedId &&
      catalog &&
      !catalog.providers.some((item) => item.id === selectedId)
    )
      setSelectedId(catalog.providers[0]?.id ?? null);
  }, [catalog, selectedId]);
  const selected = useMemo(
    () => catalog?.providers.find((item) => item.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  const mutate = async (
    operation: (revision: number) => Promise<unknown>,
    success: string,
  ) => {
    if (!catalog) return;
    setError("");
    try {
      await operation(catalog.revision);
      setModal(null);
      setNotice(success);
      await catalogQuery.refetch();
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.problem.code === "revision_conflict" &&
        cause.problem.current
      ) {
        setConflict({
          current: cause.problem.current as Catalog,
          retry: operation,
        });
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      throw cause;
    }
  };

  const saveProvider = async (
    initial: Provider | null,
    input: ProviderInput,
  ) => {
    await mutate(
      (revision) =>
        initial
          ? updateProvider(initial.id, input, revision)
          : createProvider(input, revision),
      initial ? "供应商已更新" : "供应商已添加",
    );
  };
  const saveModel = async (
    providerId: string,
    initial: ModelEntry | null,
    input: ModelInput,
  ) => {
    await mutate(
      (revision) =>
        initial
          ? updateModel(initial.id, input, revision)
          : addModel(providerId, input, revision),
      initial ? "模型已更新" : "模型已添加",
    );
  };
  const runTest = async (model: ModelEntry) => {
    setTestingId(model.id);
    setError("");
    try {
      const result = await testModel(model.id);
      setNotice(
        `测试成功 · ${result.latency_ms} ms · 回复：${result.output || "（空）"}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["model-logs"] });
    } catch (cause) {
      const logId =
        cause instanceof ApiError ? cause.problem.log_id : undefined;
      setError(
        `${cause instanceof Error ? cause.message : String(cause)}${logId ? ` · 日志 ${logId}` : ""}`,
      );
    } finally {
      setTestingId(null);
    }
  };

  return (
    <section className="page model-service-page">
      <header className="page-header">
        <div>
          <h1>模型服务</h1>
          <p>统一管理供应商、模型能力与加密凭证。</p>
        </div>
        <button
          className="btn primary"
          onClick={() => setModal({ kind: "provider", initial: null })}
        >
          ＋ 添加供应商
        </button>
      </header>
      {error ? (
        <div className="inline-alert danger" role="alert">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      ) : null}
      {notice ? (
        <div className="inline-alert success" role="status">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      ) : null}
      <div className="model-layout">
        <aside className="provider-list card">
          <div className="card-title">
            <span>供应商</span>
            <strong>{catalog?.providers.length ?? 0}</strong>
          </div>
          {catalogQuery.isLoading ? (
            <p className="empty-copy">加载中…</p>
          ) : catalog?.providers.length ? (
            catalog.providers.map((provider) => (
              <div
                key={provider.id}
                className={`provider-item${selectedId === provider.id ? " active" : ""}`}
              >
                <button
                  className="provider-select"
                  onClick={() => setSelectedId(provider.id)}
                >
                  <span className="provider-glyph">
                    <ProviderIcon kind={provider.kind} size={19} />
                  </span>
                  <span className="provider-copy">
                    <strong>{provider.name}</strong>
                    <small>
                      {providerKindLabel[provider.kind]} ·{" "}
                      {provider.models.length} 个模型
                    </small>
                  </span>
                </button>
                <Toggle
                  on={provider.enabled}
                  onClick={() =>
                    void mutate(
                      (revision) =>
                        setProviderEnabled(
                          provider.id,
                          !provider.enabled,
                          revision,
                        ),
                      provider.enabled ? "供应商已停用" : "供应商已启用",
                    ).catch(() => undefined)
                  }
                />
              </div>
            ))
          ) : (
            <div className="empty-block">
              <span>◇</span>
              <p>还没有供应商</p>
              <small>添加一个供应商开始管理模型。</small>
            </div>
          )}
        </aside>
        <main className="provider-detail card">
          {selected ? (
            <>
              <div className="detail-head">
                <div className="provider-identity">
                  <span className="provider-detail-icon">
                    <ProviderIcon kind={selected.kind} size={26} />
                  </span>
                  <div>
                    <div className="title-row">
                      <h2>{selected.name}</h2>
                      <span className="pill">
                        {providerKindLabel[selected.kind]}
                      </span>
                      <span className={`pill ${selected.enabled ? "ok" : ""}`}>
                        {selected.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p>{selected.base_url || "使用官方默认地址"}</p>
                  </div>
                </div>
                <div className="button-row">
                  <button
                    className="compact-action"
                    onClick={() =>
                      setModal({ kind: "provider", initial: selected })
                    }
                  >
                    <ActionIcon kind="edit" /> 编辑
                  </button>
                  <button
                    className="compact-action danger"
                    onClick={() => {
                      if (
                        confirm(`删除供应商「${selected.name}」及其全部模型？`)
                      )
                        void mutate(
                          (revision) => deleteProvider(selected.id, revision),
                          "供应商已删除",
                        ).catch(() => undefined);
                    }}
                  >
                    <ActionIcon kind="delete" /> 删除
                  </button>
                </div>
              </div>
              <div className="credential-strip">
                <div className="credential-card">
                  <span className="credential-icon">
                    <ActionIcon kind="key" />
                  </span>
                  <span className="credential-copy">
                    <small>API Key</small>
                    <strong>
                      {selected.has_api_key
                        ? `•••• ${selected.api_key_hint}`
                        : "未配置"}
                    </strong>
                  </span>
                </div>
                <div className="credential-card">
                  <span className="credential-icon">
                    <ActionIcon kind="revision" />
                  </span>
                  <span className="credential-copy">
                    <small>目录版本</small>
                    <strong>Revision {catalog?.revision}</strong>
                  </span>
                </div>
              </div>
              <div className="models-head">
                <div>
                  <h3>模型</h3>
                  <span>{selected.models.length}</span>
                </div>
                <button
                  className="btn"
                  onClick={() =>
                    setModal({
                      kind: "model",
                      providerId: selected.id,
                      initial: null,
                    })
                  }
                >
                  ＋ 添加模型
                </button>
              </div>
              <div className="model-list">
                {selected.models.length ? (
                  <>
                    <div className="model-table-head" aria-hidden>
                      <span>模型</span>
                      <span>能力</span>
                      <span>状态</span>
                      <span>操作</span>
                    </div>
                    {selected.models.map((model) => (
                      <article
                        className={`model-row${model.enabled ? "" : " disabled"}`}
                        key={model.id}
                      >
                        <div className="model-main">
                          <div className="model-copy">
                            <div className="model-name">
                              <strong>{model.label || model.slug}</strong>
                            </div>
                            <code>{model.slug}</code>
                            {model.description ? (
                              <p>{model.description}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="capabilities">
                          {model.capabilities.map((capability) => (
                            <span key={capability}>
                              {capabilityLabel[capability]}
                            </span>
                          ))}
                        </div>
                        <span
                          className={`model-status${model.enabled ? " enabled" : ""}`}
                        >
                          <i /> {model.enabled ? "已启用" : "已停用"}
                        </span>
                        <div className="model-actions">
                          <button
                            className="btn test"
                            disabled={
                              testingId === model.id ||
                              !model.enabled ||
                              !selected.enabled
                            }
                            onClick={() => void runTest(model)}
                          >
                            {testingId === model.id ? "测试中…" : "测试调用"}
                          </button>
                          <button
                            className="row-icon-action"
                            aria-label={`编辑 ${model.label || model.slug}`}
                            onClick={() =>
                              setModal({
                                kind: "model",
                                providerId: selected.id,
                                initial: model,
                              })
                            }
                          >
                            <ActionIcon kind="edit" />
                          </button>
                          <button
                            className="row-icon-action danger"
                            aria-label={`删除 ${model.label || model.slug}`}
                            onClick={() => {
                              if (confirm(`删除模型「${model.slug}」？`))
                                void mutate(
                                  (revision) => deleteModel(model.id, revision),
                                  "模型已删除",
                                ).catch(() => undefined);
                            }}
                          >
                            <ActionIcon kind="delete" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </>
                ) : (
                  <div className="empty-block model-empty">
                    <span>＋</span>
                    <p>尚未添加模型</p>
                    <small>模型标识会原样发送给供应商。</small>
                  </div>
                )}
              </div>
              <button className="logs-shortcut" onClick={onOpenLogs}>
                查看模型测试产生的调用日志 <span>→</span>
              </button>
            </>
          ) : (
            <div className="empty-block detail-empty">
              <span>◇</span>
              <p>选择或添加一个供应商</p>
            </div>
          )}
        </main>
      </div>
      {modal ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          {modal.kind === "provider" ? (
            <ProviderForm
              initial={modal.initial}
              onCancel={() => setModal(null)}
              onSave={(input) => saveProvider(modal.initial, input)}
            />
          ) : (
            <ModelForm
              initial={modal.initial}
              onCancel={() => setModal(null)}
              onSave={(input) =>
                saveModel(modal.providerId, modal.initial, input)
              }
            />
          )}
        </div>
      ) : null}
      {conflict ? (
        <div className="modal-backdrop">
          <div className="modal-card conflict-card">
            <span className="conflict-icon">↻</span>
            <h2>目录内容已发生变化</h2>
            <p>
              服务器当前版本为 Revision {conflict.current.revision}
              。你可以加载最新内容，或基于最新版本重试刚才的修改。
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  queryClient.setQueryData(["model-catalog"], conflict.current);
                  setConflict(null);
                }}
              >
                加载服务器版本
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const active = conflict;
                  setConflict(null);
                  void active
                    .retry(active.current.revision)
                    .then(() => catalogQuery.refetch())
                    .catch((cause) =>
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    );
                }}
              >
                基于最新版本重试
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
