import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Eye,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  SlidersHorizontal,
  Video,
  Wrench,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import type {
  GenerationOptions,
  VisualAssistantConversation,
  VisualAssistantModelOption,
} from "@features/visual-workshop/api";

export type AgentModelKind = "text" | "image" | "video";

type AgentConfigModel = {
  id: string;
  provider_id: string;
  provider_name: string;
  slug: string;
  label: string;
  description: string;
  kind: AgentModelKind;
  capabilities: string[];
};

export function AssistantModelPicker({
  textModels,
  generationOptions,
  conversation,
  loading,
  saving,
  error,
  onClose,
  onSelect,
}: {
  textModels: VisualAssistantModelOption[];
  generationOptions?: GenerationOptions;
  conversation: VisualAssistantConversation;
  loading: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSelect: (kind: AgentModelKind, modelId: string | null) => void;
}) {
  const [kind, setKind] = useState<AgentModelKind>("text");
  const [providerByKind, setProviderByKind] = useState<
    Record<AgentModelKind, string>
  >({ text: "", image: "", video: "" });
  const models = useMemo<AgentConfigModel[]>(
    () => [
      ...textModels.map((model) => ({ ...model, kind: "text" as const })),
      ...(generationOptions?.models ?? [])
        .filter((model) => model.kind !== "audio")
        .map((model) => ({
          ...model,
          kind: model.kind as "image" | "video",
          capabilities:
            model.kind === "image"
              ? ["image_generation", ...(model.sizes?.length ? ["sizes"] : [])]
              : ["video_generation"],
        })),
    ],
    [generationOptions?.models, textModels],
  );
  const currentModelIds: Record<AgentModelKind, string | null> = {
    text: conversation.model_id,
    image: conversation.image_model_id,
    video: conversation.video_model_id,
  };
  const kindModels = models.filter((model) => model.kind === kind);
  const currentProviderId = kindModels.find(
    (model) => model.id === currentModelIds[kind],
  )?.provider_id;
  const providerId = providerByKind[kind];
  const providers = useMemo(
    () =>
      Array.from(
        kindModels.reduce((result, model) => {
          const existing = result.get(model.provider_id);
          if (existing) existing.count += 1;
          else
            result.set(model.provider_id, {
              id: model.provider_id,
              name: model.provider_name,
              count: 1,
            });
          return result;
        }, new Map<string, { id: string; name: string; count: number }>()),
      ).map(([, provider]) => provider),
    [kindModels],
  );

  useEffect(() => {
    if (!providers.length) return;
    if (!providers.some((provider) => provider.id === providerId)) {
      setProviderByKind((current) => ({
        ...current,
        [kind]: currentProviderId ?? providers[0].id,
      }));
    }
  }, [currentProviderId, kind, providerId, providers]);

  const visibleModels = kindModels.filter(
    (model) => model.provider_id === providerId,
  );
  const selection = (targetKind: AgentModelKind) =>
    models.find(
      (model) =>
        model.kind === targetKind && model.id === currentModelIds[targetKind],
    );
  const kindLabel = {
    text: "Agent 文本",
    image: "图像生成",
    video: "视频生成",
  } satisfies Record<AgentModelKind, string>;
  const kindHelp = {
    text: "用于理解需求、规划步骤和调用工具",
    image: "用于 Agent 创建图片节点、参考图和视觉方案",
    video: "用于 Agent 创建视频节点、首尾帧和动态分镜",
  } satisfies Record<AgentModelKind, string>;
  const KindIcon =
    kind === "text" ? MessageSquareText : kind === "image" ? ImageIcon : Video;
  return createPortal(
    <div
      className="assistant-model-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="assistant-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="配置 Agent 模型"
      >
        <header>
          <div className="assistant-model-heading">
            <span className="assistant-model-heading-icon">
              <SlidersHorizontal aria-hidden />
            </span>
            <div>
              <h2>配置 Agent 模型</h2>
              <p>
                分别指定对话、图像和视频任务使用的模型；未指定时由 Agent
                自动选择。
              </p>
            </div>
          </div>
          <button type="button" aria-label="关闭模型选择" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div
          className="assistant-model-tabs"
          role="tablist"
          aria-label="模型用途"
        >
          {(["text", "image", "video"] as AgentModelKind[]).map((tab) => {
            const Icon =
              tab === "text"
                ? MessageSquareText
                : tab === "image"
                  ? ImageIcon
                  : Video;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={kind === tab}
                onClick={() => setKind(tab)}
              >
                <Icon aria-hidden />
                <span>
                  <strong>{kindLabel[tab]}</strong>
                  <small>{selection(tab)?.label || "自动选择"}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="assistant-model-browser">
          <nav aria-label="模型供应商">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={provider.id === providerId ? "active" : ""}
                onClick={() =>
                  setProviderByKind((current) => ({
                    ...current,
                    [kind]: provider.id,
                  }))
                }
              >
                <span>
                  <i aria-hidden>{provider.name.slice(0, 1).toUpperCase()}</i>
                  <b>{provider.name}</b>
                </span>
                <small>{provider.count}</small>
              </button>
            ))}
          </nav>
          <div className="assistant-model-content">
            <header>
              <span>
                <KindIcon aria-hidden />
                <span>
                  <strong>选择{kindLabel[kind]}模型</strong>
                  <small>{kindHelp[kind]}</small>
                </span>
              </span>
              <button
                type="button"
                disabled={saving || currentModelIds[kind] === null}
                onClick={() => onSelect(kind, null)}
              >
                恢复自动选择
              </button>
            </header>
            <div className="assistant-model-list">
              {loading ? (
                <div className="assistant-model-state">
                  <LoaderCircle className="spinning" aria-hidden />{" "}
                  正在读取模型…
                </div>
              ) : visibleModels.length ? (
                visibleModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={
                      model.id === currentModelIds[kind] ? "selected" : ""
                    }
                    disabled={saving}
                    onClick={() => onSelect(kind, model.id)}
                  >
                    <span>
                      <strong>{model.label}</strong>
                      {model.id === currentModelIds[kind] ? (
                        <i className="assistant-model-selected">
                          <Check aria-hidden />
                        </i>
                      ) : null}
                    </span>
                    <code>{model.slug}</code>
                    {model.description ? <p>{model.description}</p> : null}
                    <footer>
                      {kind === "text" ? (
                        <em>
                          <MessageSquareText aria-hidden /> 对话
                        </em>
                      ) : null}
                      {kind === "image" ? (
                        <em>
                          <ImageIcon aria-hidden /> 图像生成
                        </em>
                      ) : null}
                      {kind === "video" ? (
                        <em>
                          <Video aria-hidden /> 视频生成
                        </em>
                      ) : null}
                      {model.capabilities.includes("vision") ? (
                        <em className="vision">
                          <Eye aria-hidden /> 视觉
                        </em>
                      ) : null}
                      {model.capabilities.includes("tools") ? (
                        <em>
                          <Wrench aria-hidden /> 工具
                        </em>
                      ) : null}
                    </footer>
                  </button>
                ))
              ) : (
                <div className="assistant-model-state">
                  没有可用的{kindLabel[kind]}模型
                </div>
              )}
            </div>
          </div>
        </div>
        <footer>
          <span className="assistant-model-footer-label">当前 Agent 配置</span>
          {(["text", "image", "video"] as AgentModelKind[]).map((item) => (
            <span className="assistant-model-summary" key={item}>
              <small>{kindLabel[item]}</small>
              <strong>{selection(item)?.label || "自动选择"}</strong>
            </span>
          ))}
          <span
            className={
              error
                ? "assistant-model-save-state error"
                : "assistant-model-save-state"
            }
          >
            {saving ? "正在保存…" : error || "配置已保存"}
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
