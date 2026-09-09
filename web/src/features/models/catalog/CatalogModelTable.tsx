import { Play } from "lucide-react";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import { capabilityLabel, providerKindLabel } from "./catalogOptions";
import {
  canDeleteEntity,
  canEditField,
  type CatalogModel,
  type ModelCatalogEditorProps,
} from "./catalogTypes";
import {
  catalogModelStatus,
  modelTestMode,
  type CatalogRow,
} from "./catalogPresentation";
import { CatalogMenu, type CatalogMenuItem } from "./CatalogMenu";

export function CatalogModelTable({
  rows,
  permissions,
  onTestModel,
  onEdit,
  onCopy,
  onDelete,
  onToggle,
}: Pick<ModelCatalogEditorProps, "permissions" | "onTestModel"> & {
  rows: CatalogRow[];
  onEdit: (row: CatalogRow) => void;
  onCopy: (model: CatalogModel) => void;
  onDelete: (model: CatalogModel) => void;
  onToggle: (model: CatalogModel) => void;
}) {
  if (!rows.length)
    return (
      <div className="mc-empty">
        <h3>没有匹配的模型</h3>
        <p>调整筛选条件，或为接入连接添加模型。</p>
      </div>
    );
  return (
    <table className="mc-model-table">
      <thead>
        <tr>
          <th>模型</th>
          <th>支持能力</th>
          <th>接入来源</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { model, provider, supplierName } = row;
          const name = model.label || model.slug;
          const supported = modelTestMode(model, provider);
          const available = model.enabled && provider.enabled;
          const menu: CatalogMenuItem[] = [];
          if (permissions.canWrite) {
            menu.push({ label: `编辑 ${name}`, onClick: () => onEdit(row) });
            if (canEditField(permissions, model, "enabled"))
              menu.push({
                label: `${model.enabled ? "停用" : "启用"} ${name}`,
                onClick: () => onToggle(model),
              });
            menu.push({ label: `复制 ${name}`, onClick: () => onCopy(model) });
            if (canDeleteEntity(permissions, model))
              menu.push({
                label: `删除 ${name}`,
                danger: true,
                onClick: () => onDelete(model),
              });
          }
          return (
            <tr key={model.id} className={available ? "" : "mc-disabled-row"}>
              <td data-label="模型">
                <div className="mc-model-name">
                  <span className="mc-provider-icon">
                    <ProviderIcon kind={provider.kind} size={23} />
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <code>{model.slug}</code>
                    {model.origin === "role_template" && (
                      <span className="mc-origin">平台模板</span>
                    )}
                  </div>
                </div>
              </td>
              <td data-label="支持能力">
                <div className="mc-badges">
                  {model.capabilities.map((capability) => (
                    <span key={capability}>
                      {capability === "vision"
                        ? "图片理解"
                        : capabilityLabel[capability]}
                    </span>
                  ))}
                </div>
              </td>
              <td data-label="接入来源">
                <strong className="mc-source">{provider.name}</strong>
                <small>
                  {supplierName} · {providerKindLabel[provider.kind]}
                </small>
              </td>
              <td data-label="状态">
                <span className={`mc-status ${available ? "is-enabled" : ""}`}>
                  <i />
                  {catalogModelStatus(model, provider)}
                </span>
              </td>
              <td data-label="操作">
                <div className="mc-row-actions">
                  {permissions.canTest &&
                    onTestModel &&
                    (supported ? (
                      <button
                        type="button"
                        className="btn mc-test"
                        disabled={!available}
                        onClick={() => onTestModel(model, provider)}
                        aria-label={`测试 ${name}`}
                      >
                        <Play size={15} />
                        去测试
                      </button>
                    ) : (
                      <span className="mc-help">暂不支持测试</span>
                    ))}
                  <CatalogMenu label={`${name} 操作`} items={menu} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
