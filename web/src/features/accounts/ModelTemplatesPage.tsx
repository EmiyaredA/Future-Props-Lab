import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@generated/api";
import {
  ModelCatalogEditor,
  type ModelCatalogActions,
  type ModelCatalogValue,
} from "@features/models";
import { getModelCategories } from "@features/models";
import { modelQueryKeys } from "@features/models";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { accountQueryKeys } from "./queryKeys";
import { ManagementDialog, ManagementError } from "./ManagementUi";
import { useManagementDraft } from "./useManagementDraft";
import {
  fetchTemplate,
  fetchSyncJob,
  fetchSyncHistory,
  platformRoleOptions,
  previewTemplate,
  saveTemplate,
  startSyncJob,
  type PlatformRole,
} from "./platformApi";
type Draft = components["schemas"]["RoleModelTemplateIn"]["value"];
type Template = Awaited<ReturnType<typeof fetchTemplate>>;
const templateDraft = (value: Template["value"]): Draft => ({
  ...value,
  providers: (value.providers || []).map((p) => ({
    ...p,
    api_key: "",
    clear_api_key: false,
  })),
});
type Capability =
  components["schemas"]["ModelEntryOut"]["capabilities"][number];
const purposes: { value: Capability; label: string }[] = [
  { value: "chat", label: "对话" },
  { value: "image_generation", label: "图像生成" },
  { value: "video_generation", label: "视频生成" },
  { value: "voice", label: "实时语音" },
  { value: "speech_recognition", label: "语音识别" },
  { value: "audio_generation", label: "音频生成" },
];
export function ModelTemplatesPage() {
  const [role, setRole] = useState<PlatformRole>("member");
  const query = useQuery({
    queryKey: accountQueryKeys.template(role),
    queryFn: () => fetchTemplate(role),
  });
  const [dirty, setDirty] = useState(false);
  const [next, setNext] = useState<PlatformRole | null>(null);
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>全局设置</h1>
          <p>为各平台身份配置新工作区的模型目录，并预览同步已有工作区。</p>
        </div>
      </header>
      <div
        className="governance-role-tabs"
        role="tablist"
        aria-label="模板适用身份"
      >
        {platformRoleOptions.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={role === option.value}
            className={role === option.value ? "active" : ""}
            onClick={() => {
              const selected = option.value as PlatformRole;
              if (selected !== role) {
                if (dirty) setNext(selected);
                else setRole(selected);
              }
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ManagementError error={query.error} />
      {query.isError && (
        <button className="btn" onClick={() => void query.refetch()}>
          重新加载
        </button>
      )}
      {query.data ? (
        <TemplateEditor key={role} initial={query.data} onDirty={setDirty} />
      ) : (
        <p className="empty-copy">正在加载角色模板…</p>
      )}
      <ConfirmDialog
        open={!!next}
        title="放弃未保存的模板更改？"
        description="切换角色将清除当前模板草稿。"
        onCancel={() => setNext(null)}
        onConfirm={() => {
          if (next) setRole(next);
          setNext(null);
          setDirty(false);
        }}
      />
    </section>
  );
}
function TemplateEditor({
  initial,
  onDirty,
}: {
  initial: Template;
  onDirty: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState<Draft>(templateDraft(initial.value));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Awaited<
    ReturnType<typeof fetchSyncJob>
  > | null>(null);
  const history = useQuery({
    queryKey: accountQueryKeys.syncHistory(current.role),
    queryFn: () => fetchSyncHistory(current.role),
  });
  const categories = useQuery({
    queryKey: modelQueryKeys.categories,
    queryFn: getModelCategories,
  });
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(templateDraft(current.value));
  useManagementDraft("model-template", dirty, onDirty);
  const progress = useQuery({
    queryKey: accountQueryKeys.syncJob(job?.id || ""),
    queryFn: () => fetchSyncJob(job!.id),
    enabled: !!job && ["pending", "running"].includes(job.status),
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : 1500,
  });
  const shownJob = progress.data || job;
  const catalog = useMemo<ModelCatalogValue>(
    () => ({
      suppliers: (draft.suppliers || []).map((s) => ({
        ...s,
        id: s.template_key,
        origin: "role_template",
      })),
      providers: (draft.providers || []).map((p) => ({
        id: p.template_key,
        name: p.name,
        kind: p.kind,
        base_url: p.base_url || "",
        supplier_id: p.supplier_key || null,
        enabled: p.enabled ?? true,
        origin: "role_template",
        template_key: p.template_key,
        has_api_key: !!p.api_key || !!p.has_api_key,
        api_key_hint: p.api_key ? "待保存" : p.api_key_hint || "",
        models: (p.models || []).map((m) => ({
          ...m,
          id: m.template_key,
          provider_id: p.template_key,
          label: m.label || m.slug,
          description: m.description || "",
          enabled: m.enabled ?? true,
          capabilities: m.capabilities || ["chat"],
          categories: m.categories || [],
          origin: "role_template",
          managed_fields: [],
        })),
      })),
    }),
    [draft],
  );
  const updateProvider = (
    id: string,
    change: Partial<NonNullable<Draft["providers"]>[number]>,
  ) =>
    setDraft((old) => ({
      ...old,
      providers: (old.providers || []).map((p) =>
        p.template_key === id ? { ...p, ...change } : p,
      ),
    }));
  const updateModel = (
    id: string,
    change: Partial<
      NonNullable<NonNullable<Draft["providers"]>[number]["models"]>[number]
    >,
  ) =>
    setDraft((old) => ({
      ...old,
      providers: (old.providers || []).map((p) => ({
        ...p,
        models: (p.models || []).map((m) =>
          m.template_key === id ? { ...m, ...change } : m,
        ),
      })),
    }));
  const actions: ModelCatalogActions = {
    createSupplier: (input) =>
      setDraft((old) => ({
        ...old,
        suppliers: [
          ...(old.suppliers || []),
          { ...input, template_key: crypto.randomUUID() },
        ],
      })),
    updateSupplier: (id, input) =>
      setDraft((old) => ({
        ...old,
        suppliers: (old.suppliers || []).map((s) =>
          s.template_key === id ? { ...s, ...input } : s,
        ),
      })),
    deleteSupplier: (id) => {
      if ((draft.providers || []).some((p) => p.supplier_key === id))
        throw new Error("请先移出仍引用该分组的连接");
      setDraft((old) => ({
        ...old,
        suppliers: (old.suppliers || []).filter((s) => s.template_key !== id),
      }));
    },
    createProvider: (input) => {
      const templateKey = crypto.randomUUID();
      setDraft((old) => ({
        ...old,
        providers: [
          ...(old.providers || []),
          {
            ...input,
            has_api_key: false,
            api_key_hint: "",
            clear_api_key: false,
            supplier_key: input.supplier_id || null,
            template_key: templateKey,
            models: [],
          },
        ],
      }));
      return { id: templateKey };
    },
    updateProvider: (id, input) =>
      updateProvider(id, {
        ...input,
        api_key:
          input.api_key ||
          draft.providers?.find((p) => p.template_key === id)?.api_key ||
          "",
        supplier_key: input.supplier_id || null,
      }),
    deleteProvider: (id) =>
      setDraft((old) => ({
        ...old,
        providers: (old.providers || []).filter((p) => p.template_key !== id),
        defaults: Object.fromEntries(
          Object.entries(old.defaults || {}).filter(
            ([, key]) =>
              !old.providers
                ?.find((p) => p.template_key === id)
                ?.models?.some((m) => m.template_key === key),
          ),
        ),
      })),
    setProviderEnabled: (id, enabled) => updateProvider(id, { enabled }),
    createModel: (providerId, input) =>
      updateProvider(providerId, {
        models: [
          ...(draft.providers?.find((p) => p.template_key === providerId)
            ?.models || []),
          { ...input, template_key: crypto.randomUUID() },
        ],
      }),
    updateModel: (id, input) => updateModel(id, input),
    setModelEnabled: (id, enabled) => updateModel(id, { enabled }),
    deleteModel: (id) =>
      setDraft((old) => ({
        ...old,
        providers: (old.providers || []).map((p) => ({
          ...p,
          models: (p.models || []).filter((m) => m.template_key !== id),
        })),
        defaults: Object.fromEntries(
          Object.entries(old.defaults || {}).filter(([, key]) => key !== id),
        ),
      })),
  };
  const work = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="governance-template-note">
        <span>
          新工作区按拥有者身份初始化。现有空间通过下方预览后同步，自建连接及有效默认选择会保留。
        </span>
        <small>当前模板版本 {current.revision}</small>
      </div>
      <ModelCatalogEditor
        value={catalog}
        categories={categories.data?.items || []}
        actions={actions}
        permissions={{
          canWrite: !busy,
          canEditField: () => true,
          canDelete: () => true,
        }}
        advancedInfo="模板密钥仅用于服务端连接，工作区不能提取或修改。"
      />
      <section className="management-list-panel governance-panel">
        <header>
          <div>
            <h2>默认模型用途</h2>
            <p>按能力选择默认模型，未指定时沿用工作区现有选择。</p>
          </div>
        </header>
        <div className="governance-quota-grid">
          {purposes.map((purpose) => (
            <label key={purpose.value}>
              {purpose.label}
              <CustomSelect
                ariaLabel={`${purpose.label}默认模型`}
                value={draft.defaults?.[purpose.value] || ""}
                options={[
                  { value: "", label: "未指定" },
                  ...catalog.providers
                    .filter((p) => p.enabled)
                    .flatMap((p) =>
                      p.models
                        .filter(
                          (m) =>
                            m.enabled && m.capabilities.includes(purpose.value),
                        )
                        .map((m) => ({
                          value: m.id,
                          label: `${p.name} / ${m.label}`,
                        })),
                    ),
                ]}
                onChange={(value) => {
                  const defaults = { ...draft.defaults };
                  if (value) defaults[purpose.value] = value;
                  else delete defaults[purpose.value];
                  setDraft({ ...draft, defaults });
                }}
              />
            </label>
          ))}
        </div>
      </section>
      {(draft.providers || []).some((p) => p.has_api_key || p.api_key) && (
        <section className="management-list-panel governance-panel">
          <header>
            <div>
              <h2>模板连接密钥</h2>
              <p>清除会在保存模板后生效，已有工作区在确认同步后更新。</p>
            </div>
          </header>
          <div className="governance-template-secrets">
            {(draft.providers || [])
              .filter((p) => p.has_api_key || p.api_key)
              .map((p) => (
                <div key={p.template_key}>
                  <span>
                    {p.name} ·{" "}
                    {p.clear_api_key
                      ? "保存后清除"
                      : p.api_key
                        ? "有待保存密钥"
                        : p.api_key_hint || "已配置"}
                  </span>
                  <button
                    className="btn"
                    onClick={() =>
                      updateProvider(p.template_key, {
                        clear_api_key: !p.clear_api_key,
                        api_key: "",
                      })
                    }
                  >
                    {p.clear_api_key ? "保留原密钥" : "清除模板密钥"}
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}
      <ManagementError error={error} />
      <div className="governance-save-bar">
        <span>{dirty ? "有尚未保存的更改" : "模板已保存"}</span>
        <div className="button-row">
          {!!error && (
            <button
              className="btn"
              onClick={() =>
                void work(async () => {
                  const latest = await fetchTemplate(current.role);
                  setCurrent(latest);
                })
              }
            >
              读取最新版本，保留草稿
            </button>
          )}
          <button
            className="btn"
            disabled={
              busy ||
              dirty ||
              (!draft.providers?.length && !draft.suppliers?.length)
            }
            onClick={() =>
              void work(async () =>
                setJob(await previewTemplate(current.role, current.revision)),
              )
            }
          >
            预览同步已有空间
          </button>
          <button
            className="btn primary"
            disabled={busy || !dirty}
            onClick={() =>
              void work(async () => {
                const result = await saveTemplate(current.role, {
                  expected_revision: current.revision,
                  value: draft,
                });
                setCurrent(result);
                setDraft(templateDraft(result.value));
              })
            }
          >
            保存角色模板
          </button>
        </div>
      </div>
      <section className="management-list-panel governance-panel">
        <header>
          <div>
            <h2>最近同步记录</h2>
            <p>同步任务会持续执行，可重新打开查看结果。</p>
          </div>
          <button className="btn" onClick={() => void history.refetch()}>
            刷新记录
          </button>
        </header>
        <ManagementError error={history.error} />
        <div className="governance-sync-items">
          {history.data?.length ? (
            history.data.map((item) => (
              <button
                className="btn"
                key={item.id}
                onClick={() => setJob(item)}
              >
                {new Date(item.created_at).toLocaleString()} ·{" "}
                {item.status === "completed"
                  ? "已完成"
                  : item.status === "preview"
                    ? "待确认"
                    : "同步中"}{" "}
                · {item.items.length} 个空间
              </button>
            ))
          ) : (
            <p className="empty-copy">暂无同步记录</p>
          )}
        </div>
      </section>
      {shownJob && (
        <ManagementDialog
          title={
            shownJob.status === "preview" ? "确认同步范围" : "模板同步进度"
          }
          close={() => {
            setJob(null);
          }}
          pending={busy}
        >
          <p>
            每个空间独立校验版本。冲突空间会跳过，不覆盖自建配置；不再出现在模板中的旧模型会保留，以保护项目引用。
          </p>
          <div className="governance-sync-items">
            {shownJob.items.map((item) => (
              <article key={item.id}>
                <strong>{item.workspace_name}</strong>
                <span>
                  {{
                    pending: "待执行",
                    succeeded: "已完成",
                    skipped: "已跳过",
                    failed: "失败",
                  }[item.status] || item.status}
                </span>
                <small>
                  新增 {item.summary.added?.length || 0} · 更新{" "}
                  {item.summary.updated?.length || 0} · 保留{" "}
                  {item.summary.retained?.length || 0}
                </small>
                {item.summary.conflicts?.map((value) => (
                  <p key={value}>{value}</p>
                ))}
                {item.error_message && <p>{item.error_message}</p>}
              </article>
            ))}
          </div>
          <ManagementError error={error} />
          <footer>
            <button className="btn" onClick={() => setJob(null)}>
              关闭
            </button>
            {shownJob.status === "preview" && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void work(async () =>
                    setJob(await startSyncJob(shownJob.id, shownJob.revision)),
                  )
                }
              >
                确认同步
              </button>
            )}
          </footer>
        </ManagementDialog>
      )}
    </>
  );
}
