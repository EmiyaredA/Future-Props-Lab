import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { VisualWorkshopCanvasPage } from "@features/visual-workshop/canvas";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import {
  createVisualAssistantConversation,
  createGenerationTask,
  deleteVisualAssistantConversation,
  getGenerationOptions,
  getGenerationTask,
  getGenerationTasks,
  getVisualAssistantConversation,
  getVisualAssistantConversations,
  getVisualAssistantModels,
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualAssistantConversation,
  patchVisualWorkshopProject,
  putVisualCanvas,
  resolveVisualAssistantApproval,
  streamVisualAssistant,
} from "@features/visual-workshop/api";
import { fetchApiBlob } from "@platform/api/client";
import {
  assistantConversation,
  canvasProject as project,
} from "./visual-workshop-canvas-fixtures";

export function renderCanvas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VisualWorkshopCanvasPage
        projectId="project-1"
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** Resets the canvas to one empty project so every test starts from the same board. */
export function primeCanvasMocks() {
  vi.clearAllMocks();
  window.localStorage.clear();
  delete window.futurePropsDesktop;
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
  });
  vi.mocked(getVisualWorkshopProject).mockResolvedValue({
    ...project,
    is_official: false,
  });
  vi.mocked(getVisualCanvas).mockResolvedValue({
    project_id: "project-1",
    edges: [],
    nodes: [],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_projectId, nodes, expectedRevision) => ({
      project_id: "project-1",
      edges: [],
      nodes,
      revision: expectedRevision + 1,
      updated_at: "2026-08-03T08:00:01Z",
    }),
  );
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(getGenerationTasks).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["preview"], { type: "image/png" }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(uploadManagedFile).mockReset();
  vi.mocked(getVisualAssistantConversations).mockResolvedValue({
    items: [assistantConversation],
  });
  vi.mocked(getVisualAssistantConversation).mockResolvedValue(
    assistantConversation,
  );
  vi.mocked(createVisualAssistantConversation).mockResolvedValue(
    assistantConversation,
  );
  vi.mocked(getVisualAssistantModels).mockResolvedValue({
    items: [
      {
        id: "model-chat",
        provider_id: "provider-openai",
        provider_name: "OpenAI 兼容网关",
        slug: "demo-chat",
        label: "Demo Chat",
        description: "快速文本模型",
        capabilities: ["chat", "tools"],
      },
      {
        id: "model-vision",
        provider_id: "provider-anthropic",
        provider_name: "Anthropic",
        slug: "claude-vision",
        label: "Claude Vision",
        description: "支持图片理解",
        capabilities: ["chat", "vision"],
      },
    ],
  });
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [
      {
        id: "model-image",
        provider_id: "provider-image",
        provider_name: "SenseAudio Image",
        kind: "image",
        slug: "senseaudio-image-pro",
        label: "Image Pro",
        description: "高质量图像生成",
        sizes: ["1024x1024"],
      },
      {
        id: "model-video",
        provider_id: "provider-video",
        provider_name: "SenseAudio Video",
        kind: "video",
        slug: "senseaudio-video-pro",
        label: "Video Pro",
        description: "高质量视频生成",
      },
    ],
  });
  vi.mocked(patchVisualAssistantConversation).mockImplementation(
    async (_projectId, _conversationId, expectedRevision, changes) => ({
      ...assistantConversation,
      title: changes.title ?? assistantConversation.title,
      model_id:
        changes.model_id === undefined
          ? assistantConversation.model_id
          : changes.model_id,
      model_slug:
        changes.model_id === "model-vision"
          ? "claude-vision"
          : changes.model_id === null
            ? ""
            : assistantConversation.model_slug,
      image_model_id:
        changes.image_model_id === undefined
          ? assistantConversation.image_model_id
          : changes.image_model_id,
      image_model_slug:
        changes.image_model_id === "model-image"
          ? "senseaudio-image-pro"
          : changes.image_model_id === null
            ? ""
            : assistantConversation.image_model_slug,
      video_model_id:
        changes.video_model_id === undefined
          ? assistantConversation.video_model_id
          : changes.video_model_id,
      video_model_slug:
        changes.video_model_id === "model-video"
          ? "senseaudio-video-pro"
          : changes.video_model_id === null
            ? ""
            : assistantConversation.video_model_slug,
      revision: expectedRevision + 1,
    }),
  );
  vi.mocked(deleteVisualAssistantConversation).mockResolvedValue({
    deleted: true,
  });
  vi.mocked(resolveVisualAssistantApproval).mockResolvedValue({
    accepted: true,
  });
  vi.mocked(streamVisualAssistant).mockReset();
  vi.mocked(createGenerationTask).mockReset();
  vi.mocked(getGenerationTask).mockReset();
  vi.mocked(patchVisualWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
    }),
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}
