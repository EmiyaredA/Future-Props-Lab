import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ArrowLeft, Plus } from "lucide-react";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import { providerKindLabel } from "./catalogOptions";
import { CatalogMenu } from "./CatalogMenu";
import { navigateCatalogTabs } from "./catalogKeyboard";
import {
  canDeleteEntity,
  canEditField,
  type CatalogProvider,
  type CatalogSupplier,
  type ModelCatalogEditorProps,
} from "./catalogTypes";

export function CatalogConnections({
  value,
  permissions,
  advancedInfo,
  selectedId,
  onSelect,
  onNewSupplier,
  onEditSupplier,
  onDeleteSupplier,
  onOrganizeByProtocol,
  onNewProvider,
  onEditProvider,
  onCopyProvider,
  onDeleteProvider,
  onToggleProvider,
  children,
  onAddModel,
}: Pick<ModelCatalogEditorProps, "value" | "permissions" | "advancedInfo"> & {
  selectedId: string | null;
  onSelect: (id: string) => void;
  children: ReactNode;
  onNewSupplier: () => void;
  onEditSupplier: (supplier: CatalogSupplier) => void;
  onDeleteSupplier: (supplier: CatalogSupplier) => void;
  onOrganizeByProtocol?: () => void;
  onNewProvider: () => void;
  onEditProvider: (provider: CatalogProvider) => void;
  onCopyProvider: (provider: CatalogProvider) => void;
  onDeleteProvider: (provider: CatalogProvider) => void;
  onToggleProvider: (provider: CatalogProvider) => void;
  onAddModel: (providerId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [detail, setDetail] = useState(false);
  const [tab, setTab] = useState<"models" | "config">("models");
  const selected =
    value.providers.find((provider) => provider.id === selectedId) ??
    value.providers[0];
  const groups: CatalogSupplier[] = [
    ...value.suppliers,
    { id: "", name: "未归类" },
  ];
  const ungroupedCount = value.providers.filter(
    (provider) => !provider.supplier_id,
  ).length;
  const canAdd =
    selected &&
    permissions.canWrite &&
    (selected.origin !== "role_template" ||
      permissions.canEditField?.(selected, "models"));
  return (
    <div
      className={`mc-connections ${detail && selected ? "mc-show-detail" : ""}`}
    >
      <aside className="mc-supplier-tree">
        <header>
          <h2>协议类型</h2>
          <div className="mc-supplier-tree-actions">
            {permissions.canWrite &&
              ungroupedCount > 0 &&
              onOrganizeByProtocol && (
                <button
                  className="mc-link"
                  type="button"
                  onClick={onOrganizeByProtocol}
                >
                  按接入协议整理
                </button>
              )}
            {permissions.canWrite && (
              <button
                className="mc-icon"
                type="button"
                aria-label="添加协议类型"
                onClick={onNewSupplier}
              >
                <Plus size={18} />
              </button>
            )}
          </div>
        </header>
        {groups.map((supplier) => {
          const connections = value.providers.filter(
            (provider) => (provider.supplier_id ?? "") === supplier.id,
          );
          if (!supplier.id && !connections.length && value.suppliers.length)
            return null;
          const expanded = !collapsed.includes(supplier.id);
          return (
            <section key={supplier.id} className="mc-supplier-group">
              <div className="mc-supplier-heading">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((items) =>
                      expanded
                        ? [...items, supplier.id]
                        : items.filter((id) => id !== supplier.id),
                    )
                  }
                >
                  {expanded ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <strong>{supplier.name}</strong>
                  {supplier.origin === "role_template" && (
                    <small>平台模板</small>
                  )}
                  <small>{connections.length} 个连接</small>
                </button>
                {supplier.id && permissions.canWrite && (
                  <CatalogMenu
                    label={`${supplier.name} 操作`}
                    items={[
                      ...(canEditField(permissions, supplier, "name")
                        ? [
                            {
                              label: "重命名协议类型",
                              onClick: () => onEditSupplier(supplier),
                            },
                          ]
                        : []),
                      ...(canDeleteEntity(permissions, supplier)
                        ? [
                            {
                              label: "删除协议类型",
                              danger: true,
                              onClick: () => onDeleteSupplier(supplier),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
              {expanded && (
                <div className="mc-connection-list">
                  {connections.map((provider) => (
                    <button
                      type="button"
                      key={provider.id}
                      aria-current={
                        provider.id === selected?.id ? "true" : undefined
                      }
                      onClick={() => {
                        onSelect(provider.id);
                        setDetail(true);
                        setTab("models");
                      }}
                    >
                      <span
                        className={`mc-status ${provider.enabled ? "is-enabled" : ""}`}
                      >
                        <i />
                      </span>
                      <span>
                        <strong>{provider.name}</strong>
                        <small>
                          {provider.models.length} 个模型
                          {provider.origin === "role_template"
                            ? " · 平台模板"
                            : ""}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!connections.length && <p className="mc-help">暂无连接</p>}
                </div>
              )}
            </section>
          );
        })}
        {permissions.canWrite && (
          <button
            type="button"
            className="btn mc-add-connection"
            onClick={onNewProvider}
          >
            <Plus size={16} />
            添加连接
          </button>
        )}
      </aside>
      <section className="mc-connection-detail">
        <button
          type="button"
          className="mc-link mc-mobile-back"
          onClick={() => setDetail(false)}
        >
          <ArrowLeft size={16} />
          返回协议类型列表
        </button>
        {selected ? (
          <>
            <p className="mc-breadcrumb">
              {value.suppliers.find((s) => s.id === selected.supplier_id)
                ?.name ?? "未归类"}{" "}
              / {selected.name}
            </p>
            <div className="mc-detail-heading">
              <span className="mc-provider-icon">
                <ProviderIcon kind={selected.kind} size={30} />
              </span>
              <div>
                <h2>{selected.name}</h2>
                <div className="mc-detail-meta">
                  <span>{providerKindLabel[selected.kind]}</span>
                  <span
                    className={`mc-status ${selected.enabled ? "is-enabled" : ""}`}
                  >
                    <i />
                    {selected.enabled ? "已启用" : "连接已停用"}
                  </span>
                  {selected.origin === "role_template" && (
                    <span className="mc-origin">平台模板</span>
                  )}
                </div>
              </div>
            </div>
            <div
              className="mc-tabs"
              role="tablist"
              aria-label="连接详情"
              onKeyDown={navigateCatalogTabs}
            >
              {(
                [
                  ["models", "已接入模型"],
                  ["config", "连接配置"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "models" ? (
              <>
                <div className="mc-list-heading">
                  <h3>
                    已接入模型 <small>{selected.models.length}</small>
                  </h3>
                  {canAdd && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onAddModel(selected.id)}
                    >
                      <Plus size={16} />
                      添加模型
                    </button>
                  )}
                </div>
                {children}
              </>
            ) : (
              <div className="mc-config">
                <dl>
                  <div>
                    <dt>接入协议</dt>
                    <dd>{providerKindLabel[selected.kind]}</dd>
                  </div>
                  <div>
                    <dt>服务地址</dt>
                    <dd>
                      <code>{selected.base_url || "使用默认地址"}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>API Key</dt>
                    <dd>
                      {selected.has_api_key
                        ? `已配置 ···· ${selected.api_key_hint}`
                        : "未配置"}
                    </dd>
                  </div>
                </dl>
                {permissions.canWrite && (
                  <div className="mc-config-actions">
                    <button
                      className="btn"
                      onClick={() => onEditProvider(selected)}
                    >
                      编辑连接
                    </button>
                    {canEditField(permissions, selected, "enabled") && (
                      <button
                        className="btn"
                        onClick={() => onToggleProvider(selected)}
                      >
                        {selected.enabled ? "停用连接" : "启用连接"}
                      </button>
                    )}
                    <button
                      className="btn"
                      onClick={() => onCopyProvider(selected)}
                    >
                      复制为自建连接
                    </button>
                    {canDeleteEntity(permissions, selected) && (
                      <button
                        className="btn mc-danger"
                        onClick={() => onDeleteProvider(selected)}
                      >
                        删除连接
                      </button>
                    )}
                  </div>
                )}
                {selected.origin === "role_template" && (
                  <p className="mc-help">
                    连接由平台模板管理，受管理字段只能在管理中台修改。
                  </p>
                )}
                {advancedInfo && (
                  <details>
                    <summary>高级信息</summary>
                    <p>{advancedInfo}</p>
                  </details>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mc-empty">
            <h3>还没有接入连接</h3>
            <p>先添加连接，配置地址和凭证，再添加模型。</p>
          </div>
        )}
      </section>
    </div>
  );
}
