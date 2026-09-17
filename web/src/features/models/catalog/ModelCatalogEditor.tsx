import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Search, Server } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import { capabilityLabel, modelCapabilities } from "./catalogOptions";
import { CatalogModelTable } from "./CatalogModelTable";
import { CatalogConnections } from "./CatalogConnections";
import { ModelForm, ProviderForm, SupplierForm } from "./CatalogForms";
import { CatalogDialog } from "./CatalogDialog";
import { navigateCatalogTabs } from "./catalogKeyboard";
import {
  catalogRows,
  catalogTabs,
  filterCatalogRows,
  type CatalogTab,
} from "./catalogPresentation";
import type {
  CatalogModel,
  CatalogProvider,
  CatalogSupplier,
  ModelCatalogEditorProps,
} from "./catalogTypes";
import "./model-catalog.css";
import "./catalog-dialogs.css";

type Modal =
  | { kind: "supplier"; initial: CatalogSupplier | null }
  | {
      kind: "provider";
      initial: CatalogProvider | null;
      copy?: CatalogProvider;
    }
  | {
      kind: "model";
      initial: CatalogModel | null;
      providerId?: string;
      copy?: CatalogModel;
    }
  | {
      kind: "delete";
      entity: "supplier" | "provider" | "model";
      id: string;
      name: string;
    }
  | null;

export function ModelCatalogEditor(props: ModelCatalogEditorProps) {
  const { value, actions, permissions, categories, onTestModel, advancedInfo } =
    props;
  const [view, setView] = useState<"directory" | "connections">("directory");
  const [tab, setTab] = useState<CatalogTab>("all");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [capability, setCapability] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => catalogRows(value), [value]);
  const selected =
    value.providers.find((p) => p.id === selectedId) ?? value.providers[0];
  const filtered = filterCatalogRows(rows, categories, {
    tab,
    search,
    supplier,
    capability,
  });
  const activePermissions = {
    ...permissions,
    canWrite: permissions.canWrite && !busy,
  };
  const perform = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const deleteModel = (model: CatalogModel) =>
    setModal({
      kind: "delete",
      entity: "model",
      id: model.id,
      name: model.label || model.slug,
    });
  const table = (items: typeof rows, hideSource = false) => (
    <CatalogModelTable
      rows={items}
      permissions={activePermissions}
      onTestModel={onTestModel}
      hideSource={hideSource}
      onEdit={({ model, provider }) =>
        setModal({ kind: "model", initial: model, providerId: provider.id })
      }
      onCopy={(model) =>
        setModal({ kind: "model", initial: null, copy: model })
      }
      onDelete={deleteModel}
      onToggle={(model) =>
        void perform(() => actions.setModelEnabled(model.id, !model.enabled))
      }
    />
  );
  const newModel = () => {
    const available = value.providers.some(
      (provider) =>
        provider.origin !== "role_template" ||
        permissions.canEditField?.(provider, "models"),
    );
    if (available) setModal({ kind: "model", initial: null });
    else {
      setView("connections");
      setModal({ kind: "provider", initial: null });
    }
  };
  const shared = {
    value,
    actions,
    permissions,
    categories,
    onRefresh: props.onRefresh,
    onClose: () => setModal(null),
  };
  return (
    <div className="mc-editor" aria-busy={busy}>
      <div className="mc-view-toolbar">
        <div
          className="mc-tabs"
          role="tablist"
          aria-label="模型服务视图"
          onKeyDown={navigateCatalogTabs}
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "directory"}
            onClick={() => setView("directory")}
          >
            模型目录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "connections"}
            onClick={() => setView("connections")}
          >
            接入管理
          </button>
        </div>
        {permissions.canWrite && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={
              view === "directory"
                ? newModel
                : () => setModal({ kind: "provider", initial: null })
            }
          >
            <Plus size={17} />
            {view === "directory" ? "添加模型" : "添加连接"}
          </button>
        )}
      </div>
      {error && (
        <p className="mc-error" role="alert">
          {error}
        </p>
      )}
      {!permissions.canWrite && (
        <p className="mc-help">
          当前角色可以查看配置，修改配置需要工作区管理员权限。
        </p>
      )}
      {view === "directory" ? (
        <>
          <div className="mc-provider-strip" aria-label="供应商概览">
            {value.providers.slice(0, 6).map((provider) => (
              <button
                type="button"
                className="mc-provider-card"
                key={provider.id}
                onClick={() => {
                  setSelectedId(provider.id);
                  setView("connections");
                }}
              >
                <span className="mc-provider-card-icon">
                  <ProviderIcon kind={provider.kind} size={20} />
                </span>
                <span className="mc-provider-card-copy">
                  <strong>{provider.name}</strong>
                  <small>模型数 {provider.models.length}</small>
                </span>
                <span
                  className={`mc-provider-health${provider.enabled ? " is-healthy" : ""}`}
                >
                  {provider.enabled ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <Server size={13} />
                  )}
                  {provider.enabled ? "正常" : "停用"}
                </span>
              </button>
            ))}
            {permissions.canWrite && (
              <button
                type="button"
                className="mc-provider-card is-add"
                onClick={() => setModal({ kind: "provider", initial: null })}
              >
                <span className="mc-provider-card-icon">
                  <Plus size={19} />
                </span>
                <span className="mc-provider-card-copy">
                  <strong>添加供应商</strong>
                  <small>接入新的模型服务</small>
                </span>
              </button>
            )}
          </div>
          <div
            className="mc-category-tabs"
            role="tablist"
            aria-label="模型用途"
            onKeyDown={navigateCatalogTabs}
          >
            {catalogTabs.map((item) => (
              <button
                type="button"
                role="tab"
                key={item.id}
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mc-filters">
            <label className="mc-search">
              <Search size={18} aria-hidden />
              <input
                aria-label="搜索模型"
                placeholder="搜索模型名称或标识"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <CustomSelect
              ariaLabel="筛选供应商"
              value={supplier}
              onChange={setSupplier}
              options={[
                { value: "", label: "全部供应商" },
                ...value.suppliers.map((s) => ({ value: s.id, label: s.name })),
                { value: "ungrouped", label: "未分组" },
              ]}
            />
            <CustomSelect
              ariaLabel="筛选能力"
              value={capability}
              onChange={setCapability}
              options={[
                { value: "", label: "全部能力" },
                ...modelCapabilities.map((c) => ({
                  value: c,
                  label: capabilityLabel[c],
                })),
              ]}
            />
            <span className="mc-count">{filtered.length} 个模型</span>
          </div>
          {!rows.length ? (
            <div className="mc-empty">
              <h3>还没有模型</h3>
              <p>先配置接入连接，再添加可用模型。</p>
              {permissions.canWrite && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setView("connections");
                    setModal({ kind: "provider", initial: null });
                  }}
                >
                  添加接入连接
                </button>
              )}
            </div>
          ) : (
            table(filtered)
          )}
        </>
      ) : (
        <CatalogConnections
          value={value}
          permissions={activePermissions}
          advancedInfo={advancedInfo}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewSupplier={() => setModal({ kind: "supplier", initial: null })}
          onEditSupplier={(initial) => setModal({ kind: "supplier", initial })}
          onDeleteSupplier={(s) =>
            setModal({
              kind: "delete",
              entity: "supplier",
              id: s.id,
              name: s.name,
            })
          }
          onNewProvider={() => setModal({ kind: "provider", initial: null })}
          onEditProvider={(initial) => setModal({ kind: "provider", initial })}
          onCopyProvider={(copy) =>
            setModal({ kind: "provider", initial: null, copy })
          }
          onDeleteProvider={(p) =>
            setModal({
              kind: "delete",
              entity: "provider",
              id: p.id,
              name: p.name,
            })
          }
          onToggleProvider={(p) =>
            void perform(() => actions.setProviderEnabled(p.id, !p.enabled))
          }
          onAddModel={(providerId) =>
            setModal({ kind: "model", initial: null, providerId })
          }
        >
          {table(
            rows.filter((row) => row.provider.id === selected?.id),
            true,
          )}
        </CatalogConnections>
      )}
      {modal?.kind === "supplier" && (
        <SupplierForm
          {...shared}
          initial={
            value.suppliers.find((s) => s.id === modal.initial?.id) ??
            modal.initial
          }
          unavailable={
            !!modal.initial &&
            !value.suppliers.some((s) => s.id === modal.initial?.id)
          }
        />
      )}
      {modal?.kind === "provider" && (
        <ProviderForm
          {...shared}
          initial={
            value.providers.find((p) => p.id === modal.initial?.id) ??
            modal.initial
          }
          copy={modal.copy}
          unavailable={
            !!modal.initial &&
            !value.providers.some((p) => p.id === modal.initial?.id)
          }
        />
      )}
      {modal?.kind === "model" && (
        <ModelForm
          {...shared}
          initial={
            rows.find((row) => row.model.id === modal.initial?.id)?.model ??
            modal.initial
          }
          providerId={modal.providerId}
          copy={modal.copy}
          unavailable={
            !!modal.initial &&
            !rows.some((row) => row.model.id === modal.initial?.id)
          }
        />
      )}
      {modal?.kind === "delete" && (
        <CatalogDialog
          title={`删除${{ supplier: "供应商", provider: "连接", model: "模型" }[modal.entity]}`}
          label="确认删除"
          onRefresh={props.onRefresh}
          onClose={() => setModal(null)}
          disabled={!permissions.canWrite}
          onSave={() => {
            if (modal.entity === "supplier")
              return actions.deleteSupplier(modal.id);
            if (modal.entity === "provider")
              return actions.deleteProvider(modal.id);
            return actions.deleteModel(modal.id);
          }}
        >
          <p>确认删除「{modal.name}」？</p>
          <p className="mc-help">
            {modal.entity === "provider"
              ? "该连接下的模型也会被删除，此操作无法撤销。"
              : modal.entity === "supplier"
                ? "仅可删除空分组。请先将连接移至其他供应商或未分组。"
                : "删除后无法撤销。"}
          </p>
        </CatalogDialog>
      )}
    </div>
  );
}
