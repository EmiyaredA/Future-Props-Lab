import { autodlPresets } from "./autodlPresets";
import { useState } from "react";
import {
  AudioLines,
  Check,
  Cpu,
  Eye,
  Image,
  MessageSquare,
  Mic,
  Music2,
  Video,
  Wrench,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  capabilityLabel,
  modelCapabilities,
  providerBaseUrlPlaceholder,
  providerKindOptions,
} from "./catalogOptions";
import { providerMetadata } from "@features/models/metadata";
import type { ModelInput } from "@features/models/api";
import { CatalogDialog } from "./CatalogDialog";
import {
  canEditField,
  type CatalogModel,
  type CatalogProvider,
  type CatalogProviderInput,
  type ModelCatalogEditorProps,
} from "./catalogTypes";

type Shared = Pick<
  ModelCatalogEditorProps,
  "value" | "actions" | "permissions" | "categories" | "onRefresh"
> & { onClose: () => void; unavailable?: boolean };

const capabilityIcons = {
  speech_synthesis: AudioLines,
  chat: MessageSquare,
  vision: Eye,
  tools: Wrench,
  image_generation: Image,
  video_generation: Video,
  video_enhancement: Video,
  audio_generation: Music2,
  speech_recognition: Mic,
  voice: AudioLines,
};

export function ProviderForm({
  initial,
  copy,
  actions,
  permissions,
  onClose,
  onRefresh,
  onCreated,
  unavailable,
}: Shared & {
  initial: CatalogProvider | null;
  copy?: CatalogProvider;
  onCreated?: (id: string) => void;
}) {
  const source = initial ?? copy;
  const [name, setName] = useState(
    copy ? `${copy.name} 副本` : (initial?.name ?? ""),
  );
  const [kind, setKind] = useState<CatalogProvider["kind"]>(
    source?.kind ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(source?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const editable = (field: string) => canEditField(permissions, initial, field);
  const save = async () => {
    const input: CatalogProviderInput = {
      name: name.trim(),
      kind,
      base_url: baseUrl.trim(),
      api_key: apiKey,
      supplier_id: initial?.supplier_id ?? null,
      enabled: initial?.enabled ?? true,
    };
    if (initial) {
      await actions.updateProvider(initial.id, input);
      return;
    }
    const created = await actions.createProvider(input);
    if (created?.id) onCreated?.(created.id);
  };
  return (
    <CatalogDialog
      title={
        copy ? "复制为自建连接" : initial ? "编辑接入连接" : "添加接入连接"
      }
      onClose={onClose}
      onRefresh={onRefresh}
      onSave={save}
      disabled={unavailable || !permissions.canWrite || !name.trim()}
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
        <span>接入协议</span>
        <CustomSelect
          ariaLabel="接入协议"
          value={kind}
          disabled={!editable("kind")}
          options={
            ["local_relayvsr", "local_ffmpeg"].includes(kind)
              ? [
                  ...providerKindOptions,
                  { value: kind, label: providerMetadata[kind].optionLabel },
                ]
              : providerKindOptions
          }
          onChange={(next) => {
            setKind(next as typeof kind);
            if (
              ["local_qwen_tts", "local_relayvsr", "local_ffmpeg"].includes(
                next,
              )
            ) {
              setBaseUrl("");
              setApiKey("");
            }
          }}
        />
      </label>
      {!["local_qwen_tts", "local_relayvsr", "local_ffmpeg"].includes(kind) && (
        <>
          <label>
            <span>服务地址</span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label="服务地址"
              maxLength={512}
              value={baseUrl}
              disabled={!editable("base_url")}
              placeholder={providerBaseUrlPlaceholder(kind)}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <small>
              {kind === "zealman_video"
                ? "填写 ZEALMAN 面板根地址，页面查询参数会自动移除。"
                : kind === "deepseek"
                  ? "留空使用 https://api.deepseek.com；当前接入使用非思考模式，支持对话和工具调用。"
                  : "留空使用该协议的默认地址。"}
            </small>
          </label>
          <label>
            <span>API Key{kind === "zealman_video" ? "（可选）" : ""}</span>
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
        </>
      )}
      {["local_qwen_tts", "local_relayvsr", "local_ffmpeg"].includes(kind) && (
        <p>本机托管连接，由「本地模型」管理安装和运行，无需 API Key。</p>
      )}
      {initial?.origin === "role_template" && (
        <p className="mc-help">平台模板管理的字段在当前账号只读。</p>
      )}
      {copy && (
        <p className="mc-help">
          仅复制连接配置，不复制密钥。创建后可添加或复制模型。
        </p>
      )}
      {unavailable && <p role="alert">该连接已被删除，请关闭后重新选择。</p>}
    </CatalogDialog>
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
    deepseek: ["chat", "tools"],
    volcengine_image: ["image_generation"],
    senseaudio_image: ["image_generation"],
    senseaudio_video: ["video_generation"],
    volcengine_video: ["video_generation"],
    zealman_video: ["video_generation"],
    autodl_video: ["video_generation"],
    local_qwen_tts: ["speech_synthesis"],
    local_relayvsr: ["video_enhancement"],
    local_ffmpeg: ["video_enhancement"],
    senseaudio_asr: ["speech_recognition"],
    senseaudio_asr_pro: ["speech_recognition"],
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
      className="mc-model-dialog"
      subtitle="配置模型信息、支持能力与工作台用途"
      icon={<Cpu size={22} />}
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
      <section className="mc-model-identity" aria-label="基本信息">
        <h3>基本信息</h3>
        <label className="mc-model-connection">
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
                setCapabilities(
                  defaults[provider?.kind ?? "openai"] ?? ["chat"],
                );
              }
            }}
          />
        </label>
        {selectedProvider?.kind === "deepseek" && !initial && (
          <label>
            <span>DeepSeek 模型预设</span>
            <CustomSelect
              ariaLabel="DeepSeek 模型预设"
              value={
                ["deepseek-flash", "deepseek-v4-pro"].includes(slug) ? slug : ""
              }
              options={[
                { value: "", label: "自定义模型" },
                {
                  value: "deepseek-flash",
                  label: "DeepSeek Flash · 支持图像理解",
                },
                { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
              ]}
              onChange={(next) => {
                setSlug(next);
                setLabel(
                  next === "deepseek-flash"
                    ? "DeepSeek Flash"
                    : next
                      ? "DeepSeek V4 Pro"
                      : "",
                );
                setCapabilities(
                  next === "deepseek-flash"
                    ? ["chat", "tools", "vision"]
                    : ["chat", "tools"],
                );
                setCategories(["text_generation"]);
              }}
            />
            <small>使用非思考模式；也可在下方直接填写官方提供的模型 ID。</small>
          </label>
        )}
        {selectedProvider?.kind === "volcengine_video" && !initial && (
          <label>
            <span>Seedance 模型预设</span>
            <CustomSelect
              ariaLabel="Seedance 模型预设"
              value={slug}
              options={[
                { value: "", label: "选择 Seedance 版本" },
                { value: "doubao-seedance-2-0-260128", label: "Seedance 2.0" },
                { value: "doubao-seedance-2-5-260628", label: "Seedance 2.5" },
              ]}
              onChange={(value) => {
                setSlug(value);
                setLabel(
                  value.includes("2-5") ? "Seedance 2.5" : "Seedance 2.0",
                );
                setCapabilities(["video_generation"]);
                setCategories(["video_generation"]);
              }}
            />
            <small>在火山方舟开通对应模型后，使用方舟 API Key 调用。</small>
          </label>
        )}
        {selectedProvider?.kind === "autodl_video" && !initial && (
          <label>
            <span>AutoDL 工作流预设</span>
            <CustomSelect
              ariaLabel="AutoDL 工作流预设"
              value={slug}
              options={[{ value: "", label: "选择工作流" }, ...autodlPresets]}
              onChange={(value) => {
                const preset = autodlPresets.find(
                  (item) => item.value === value,
                );
                setSlug(value);
                setLabel(preset?.label ?? value);
                setDescription(preset?.description ?? "");
                setCapabilities(["video_generation"]);
                setCategories(["video_generation"]);
              }}
            />
            <small>
              使用 AutoDL ComfyUI 分组令牌，Authorization 直接发送原始 Token。
            </small>
          </label>
        )}
        {selectedProvider?.kind === "zealman_video" && !initial && (
          <label>
            <span>已支持的工作流</span>
            <CustomSelect
              ariaLabel="已支持的工作流"
              value={slug}
              options={[
                { value: "", label: "选择工作流" },
                ...["U17-9图1视频3音频V1-api", "U06-9图3音频-V5"].map(
                  (value) => ({ value, label: value }),
                ),
              ]}
              onChange={(value) => {
                setSlug(value);
                setLabel(value);
                setCapabilities(["video_generation"]);
                setCategories(["video_generation"]);
              }}
            />
          </label>
        )}
        <label className="mc-model-id">
          <span>模型标识</span>
          <input
            value={slug}
            required
            maxLength={160}
            disabled={!editable("slug")}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={
              selectedProvider?.kind === "volcengine_image"
                ? "doubao-seedream-4-5-251128"
                : "原样发送给服务端的模型 ID"
            }
          />
        </label>
        {selectedProvider?.kind === "volcengine_image" && (
          <small>
            当前支持 Seedream 4.5（doubao-seedream-4-5-251128），最多 14
            张原生参考图。
          </small>
        )}
        <label className="mc-model-name">
          <span>显示名称</span>
          <input
            value={label}
            maxLength={160}
            disabled={!editable("label")}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="mc-model-description">
          <span>说明</span>
          <textarea
            value={description}
            rows={2}
            placeholder="添加模型用途或工作流说明…"
            maxLength={255}
            disabled={!editable("description")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </section>
      <fieldset className="mc-choices" disabled={!editable("capabilities")}>
        <legend>支持能力</legend>
        <p className="mc-help">选择模型实际支持的能力，决定可用的调用方式。</p>
        <div className="mc-capability-grid">
          {modelCapabilities.map((capability) => {
            const Icon = capabilityIcons[capability];
            return (
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
                <Icon size={17} aria-hidden />
                {capabilityLabel[capability]}
                <Check className="mc-choice-check" size={14} aria-hidden />
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset
        className="mc-choices mc-model-categories"
        disabled={!editable("categories")}
      >
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
      <label className="mc-check mc-model-enabled">
        <span className="mc-model-enabled-copy">
          <strong>启用此模型</strong>
          <small>在模型测试与创作工坊中显示</small>
        </span>
        <input
          type="checkbox"
          aria-label="启用此模型"
          checked={enabled}
          disabled={!editable("enabled")}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>
      {unavailable && (
        <p role="alert">模型或所属连接已被删除，请关闭后重新选择。</p>
      )}
    </CatalogDialog>
  );
}
