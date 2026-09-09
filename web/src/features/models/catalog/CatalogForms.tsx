import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  capabilityLabel,
  modelCapabilities,
  providerBaseUrlPlaceholder,
  providerKindOptions,
} from "./catalogOptions";
import type { ModelInput } from "@features/models/api";
import { CatalogDialog } from "./CatalogDialog";
import {
  canEditField,
  type CatalogModel,
  type CatalogProvider,
  type CatalogProviderInput,
  type CatalogSupplier,
  type ModelCatalogEditorProps,
} from "./catalogTypes";

type Shared = Pick<
  ModelCatalogEditorProps,
  "value" | "actions" | "permissions" | "categories" | "onRefresh"
> & { onClose: () => void; unavailable?: boolean };

export function SupplierForm({
  initial,
  actions,
  permissions,
  onClose,
  onRefresh,
  unavailable,
}: Pick<
  Shared,
  "actions" | "permissions" | "onClose" | "unavailable" | "onRefresh"
> & {
  initial: CatalogSupplier | null;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const writable = canEditField(permissions, initial, "name");
  return (
    <CatalogDialog
      title={initial ? "编辑供应商" : "添加供应商"}
      onClose={onClose}
      onRefresh={onRefresh}
      disabled={unavailable || !name.trim() || !writable}
      onSave={() =>
        initial
          ? actions.updateSupplier(initial.id, { name: name.trim() })
          : actions.createSupplier({ name: name.trim() })
      }
    >
      <label>
        <span>供应商名称</span>
        <input
          required
          maxLength={120}
          value={name}
          disabled={!writable}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：SenseAudio"
        />
      </label>
      <p className="mc-help">
        供应商用于组织接入连接。地址和凭证在连接中分别配置。
      </p>
      {unavailable && <p role="alert">该供应商已被删除，请关闭后重新选择。</p>}
    </CatalogDialog>
  );
}

export function ProviderForm({
  initial,
  copy,
  value,
  actions,
  permissions,
  onClose,
  onRefresh,
  unavailable,
}: Shared & { initial: CatalogProvider | null; copy?: CatalogProvider }) {
  const source = initial ?? copy;
  const [name, setName] = useState(
    copy ? `${copy.name} 副本` : (initial?.name ?? ""),
  );
  const [kind, setKind] = useState<CatalogProvider["kind"]>(
    source?.kind ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(source?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [supplierId, setSupplierId] = useState(source?.supplier_id ?? "");
  const [newSupplier, setNewSupplier] = useState(false);
  const editable = (field: string) => canEditField(permissions, initial, field);
  const save = () => {
    const input: CatalogProviderInput = {
      name: name.trim(),
      kind,
      base_url: baseUrl.trim(),
      api_key: apiKey,
      supplier_id: supplierId || null,
      enabled: initial?.enabled ?? true,
    };
    return initial
      ? actions.updateProvider(initial.id, input)
      : actions.createProvider(input);
  };
  return (
    <>
      <CatalogDialog
        title={
          copy ? "复制为自建连接" : initial ? "编辑接入连接" : "添加接入连接"
        }
        onClose={onClose}
        onRefresh={onRefresh}
        onSave={save}
        disabled={
          unavailable ||
          !permissions.canWrite ||
          !name.trim() ||
          (!!supplierId && !value.suppliers.some((s) => s.id === supplierId))
        }
      >
        <label>
          <span>连接名称</span>
          <input
            value={name}
            required
            maxLength={120}
            disabled={!editable("name")}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：通用模型网关"
          />
        </label>
        <label>
          <span>所属供应商</span>
          <CustomSelect
            ariaLabel="所属供应商"
            value={supplierId}
            disabled={!editable("supplier_id")}
            options={[
              { value: "", label: "未分组" },
              ...value.suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={setSupplierId}
          />
        </label>
        {editable("supplier_id") && (
          <button
            type="button"
            className="mc-link"
            onClick={() => setNewSupplier(true)}
          >
            ＋ 新建供应商
          </button>
        )}
        <label>
          <span>接入协议</span>
          <CustomSelect
            ariaLabel="接入协议"
            value={kind}
            disabled={!editable("kind")}
            options={providerKindOptions}
            onChange={(next) => setKind(next as typeof kind)}
          />
        </label>
        <label>
          <span>服务地址</span>
          <input
            type="url"
            aria-label="服务地址"
            maxLength={512}
            value={baseUrl}
            disabled={!editable("base_url")}
            placeholder={providerBaseUrlPlaceholder(kind)}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <small>留空使用该协议的默认地址。</small>
        </label>
        <label>
          <span>API Key</span>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            disabled={!editable("api_key")}
            placeholder={
              initial?.has_api_key ? "已配置，留空保留" : "输入 API Key"
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {initial?.origin === "role_template" && (
          <p className="mc-help">平台模板管理的字段在当前工作区只读。</p>
        )}
        {copy && (
          <p className="mc-help">
            仅复制连接配置，不复制密钥。创建后可添加或复制模型。
          </p>
        )}
        {unavailable && <p role="alert">该连接已被删除，请关闭后重新选择。</p>}
      </CatalogDialog>
      {newSupplier && (
        <SupplierForm
          initial={null}
          actions={actions}
          permissions={permissions}
          onClose={() => setNewSupplier(false)}
        />
      )}
    </>
  );
}

export function ModelForm({
  initial,
  providerId,
  copy,
  value,
  actions,
  permissions,
  categories: categoryOptions,
  onClose,
  onRefresh,
  unavailable,
}: Shared & {
  initial: CatalogModel | null;
  providerId?: string;
  copy?: CatalogModel;
}) {
  const source = initial ?? copy;
  const writableProviders = value.providers.filter(
    (provider) =>
      canEditField(permissions, provider, "models") &&
      (provider.origin !== "role_template" ||
        permissions.canEditField?.(provider, "models")),
  );
  const [connection, setConnection] = useState(
    providerId ??
      (writableProviders.length === 1 ? writableProviders[0].id : ""),
  );
  const [slug, setSlug] = useState(source?.slug ?? "");
  const [label, setLabel] = useState(source?.label ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const selectedProvider = value.providers.find(
    (provider) => provider.id === connection,
  );
  const defaults: Partial<
    Record<CatalogProvider["kind"], ModelInput["capabilities"]>
  > = {
    senseaudio_image: ["image_generation"],
    senseaudio_video: ["video_generation"],
    senseaudio_asr: ["speech_recognition"],
    senseaudio_realtime: ["voice"],
    senseaudio_music: ["audio_generation"],
    senseaudio_sfx: ["audio_generation"],
  };
  const [capabilities, setCapabilities] = useState<ModelInput["capabilities"]>(
    source?.capabilities ??
      defaults[selectedProvider?.kind ?? "openai"] ?? ["chat"],
  );
  const [categories, setCategories] = useState<ModelInput["categories"]>(
    source?.categories ?? [],
  );
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const editable = (field: string) => canEditField(permissions, initial, field);
  const save = () => {
    const input: ModelInput = {
      slug: slug.trim(),
      label: label.trim(),
      description: description.trim(),
      capabilities,
      categories,
      enabled,
    };
    return initial
      ? actions.updateModel(initial.id, input)
      : actions.createModel(connection, input);
  };
  return (
    <CatalogDialog
      title={copy ? "复制为自建模型" : initial ? "编辑模型" : "添加模型"}
      onClose={onClose}
      onRefresh={onRefresh}
      onSave={save}
      disabled={
        unavailable ||
        !permissions.canWrite ||
        !slug.trim() ||
        !capabilities?.length ||
        !selectedProvider ||
        (!initial && !writableProviders.some((p) => p.id === connection))
      }
    >
      <label>
        <span>接入连接</span>
        <CustomSelect
          ariaLabel="接入连接"
          value={connection}
          disabled={!!initial}
          options={[
            { value: "", label: "选择接入连接" },
            ...(initial ? value.providers : writableProviders).map((p) => ({
              value: p.id,
              label: p.name,
            })),
          ]}
          onChange={(next) => {
            setConnection(next);
            if (!source) {
              const provider = value.providers.find((p) => p.id === next);
              setCapabilities(defaults[provider?.kind ?? "openai"] ?? ["chat"]);
            }
          }}
        />
      </label>
      <label>
        <span>模型标识</span>
        <input
          value={slug}
          required
          maxLength={160}
          disabled={!editable("slug")}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="原样发送给服务端的模型 ID"
        />
      </label>
      <label>
        <span>显示名称</span>
        <input
          value={label}
          maxLength={160}
          disabled={!editable("label")}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        <span>说明</span>
        <input
          value={description}
          maxLength={255}
          disabled={!editable("description")}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <fieldset className="mc-choices" disabled={!editable("capabilities")}>
        <legend>支持能力</legend>
        {modelCapabilities.map((capability) => (
          <button
            type="button"
            key={capability}
            aria-pressed={capabilities?.includes(capability)}
            onClick={() =>
              setCapabilities((current = []) =>
                current.includes(capability)
                  ? current.filter((item) => item !== capability)
                  : [...current, capability],
              )
            }
          >
            {capability === "vision" ? "图片理解" : capabilityLabel[capability]}
          </button>
        ))}
      </fieldset>
      <fieldset className="mc-choices" disabled={!editable("categories")}>
        <legend>用途分类</legend>
        <p className="mc-help">可多选；留空由接入类型确定默认用途。</p>
        {categoryOptions.map((category) => (
          <button
            type="button"
            key={category.id}
            aria-pressed={categories?.includes(category.id)}
            onClick={() =>
              setCategories((current = []) =>
                current.includes(category.id)
                  ? current.filter((item) => item !== category.id)
                  : [...current, category.id],
              )
            }
          >
            {category.label}
          </button>
        ))}
      </fieldset>
      <label className="mc-check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!editable("enabled")}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>启用此模型</span>
      </label>
      {unavailable && (
        <p role="alert">模型或所属连接已被删除，请关闭后重新选择。</p>
      )}
    </CatalogDialog>
  );
}
