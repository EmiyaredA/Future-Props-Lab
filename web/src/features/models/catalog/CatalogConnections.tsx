import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  Server,
} from "lucide-react";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import { providerKindLabel, providerKindOptions } from "./catalogOptions";
import { CatalogMenu, type CatalogMenuItem } from "./CatalogMenu";
import { navigateCatalogTabs } from "./catalogKeyboard";
import {
  canDeleteEntity,
  canEditField,
  type CatalogProvider,
  type ModelCatalogEditorProps,
} from "./catalogTypes";

export function CatalogConnections({
  value,
  permissions,
  advancedInfo,
  selectedId,
  onSelect,
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
  const knownKinds = providerKindOptions.map((option) => option.value);
  const presentKinds = [
    ...knownKinds.filter((kind) =>
      value.providers.some((provider) => provider.kind === kind),
    ),
    ...[
      ...new Set(
        value.providers
          .map((provider) => provider.kind)
          .filter((kind) => !knownKinds.includes(kind)),
      ),
    ],
  ];
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
        </header>
        <div className="mc-supplier-tree-body">
          {presentKinds.map((kind) => {
            const connections = value.providers.filter(
              (provider) => provider.kind === kind,
            );
            const expanded = !collapsed.includes(kind);
            const label = providerKindLabel[kind] ?? kind;
            return (
              <section key={kind} className="mc-supplier-group">
                <div className="mc-supplier-heading">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${label}，${connections.length} 个连接`}
                    onClick={() =>
                      setCollapsed((items) =>
                        expanded
                          ? [...items, kind]
                          : items.filter((id) => id !== kind),
                      )
                    }
                  >
                    {expanded ? (
                      <ChevronDown size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                    <span className="mc-kind-icon">
                      <ProviderIcon kind={kind} size={16} />
                    </span>
                    <span className="mc-kind-copy">
                      <strong>{label}</strong>
                      <small>{connections.length} 个连接</small>
                    </span>
                  </button>
                </div>
                {expanded && (
                  <div className="mc-connection-list">
                    {connections.map((provider) => {
                      const menu: CatalogMenuItem[] = [];
                      if (permissions.canWrite) {
                        menu.push({
                          label: "编辑连接",
                          onClick: () => onEditProvider(provider),
                        });
                        if (canEditField(permissions, provider, "enabled")) {
                          menu.push({
                            label: provider.enabled ? "停用连接" : "启用连接",
                            onClick: () => onToggleProvider(provider),
                          });
                        }
                        menu.push({
                          label: "复制为自建连接",
                          onClick: () => onCopyProvider(provider),
                        });
                        if (canDeleteEntity(permissions, provider)) {
                          menu.push({
                            label: "删除连接",
                            danger: true,
                            onClick: () => onDeleteProvider(provider),
                          });
                        }
                      }
                      return (
                        <div className="mc-connection-item" key={provider.id}>
                          <button
                            type="button"
                            className="mc-connection-item-main"
                            aria-current={
                              provider.id === selected?.id ? "true" : undefined
                            }
                            onClick={() => {
                              onSelect(provider.id);
                              setDetail(true);
                              setTab("models");
                            }}
                          >
                            <span className="mc-connection-item-copy">
                              <strong>{provider.name}</strong>
                              <small>
                                模型数 {provider.models.length}
                                {provider.origin === "role_template"
                                  ? " · 平台模板"
                                  : ""}
                              </small>
                            </span>
                            <span
                              className={`mc-provider-health${
                                provider.enabled ? " is-healthy" : ""
                              }`}
                            >
                              {provider.enabled ? (
                                <CheckCircle2 size={13} />
                              ) : (
                                <Server size={13} />
                              )}
                              {provider.enabled ? "正常" : "停用"}
                            </span>
                          </button>
                          <CatalogMenu
                            label={`${provider.name} 操作`}
                            items={menu}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {permissions.canWrite && (
            <button
              type="button"
              className="mc-provider-card is-add mc-add-connection"
              onClick={onNewProvider}
            >
              <span className="mc-provider-card-icon">
                <Plus size={18} />
              </span>
              <span className="mc-provider-card-copy">
                <strong>添加接入连接</strong>
                <small>接入新的模型服务</small>
              </span>
            </button>
          )}
        </div>
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
            <div className="mc-detail-heading">
              <span className="mc-provider-icon">
                <ProviderIcon kind={selected.kind} size={30} />
              </span>
              <div>
                <h2>{selected.name}</h2>
                <div className="mc-detail-meta">
                  <span
                    className={`mc-provider-health${
                      selected.enabled ? " is-healthy" : ""
                    }`}
                  >
                    {selected.enabled ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      <Server size={13} />
                    )}
                    {selected.enabled ? "正常" : "停用"}
                  </span>
                  {selected.origin === "role_template" && (
                    <span className="mc-origin">平台模板</span>
                  )}
                </div>
              </div>
            </div>
            <div className="mc-detail-toolbar">
              <div
                className="mc-tabs"
                role="tablist"
                aria-label="连接详情"
                onKeyDown={navigateCatalogTabs}
              >
                {(
                  [
                    ["models", `已接入模型 · ${selected.models.length}`],
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
              {canAdd && tab === "models" && (
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
            {tab === "models" ? (
              children
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
                      className="btn primary"
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
