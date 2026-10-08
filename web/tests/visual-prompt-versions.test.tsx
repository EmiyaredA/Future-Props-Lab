import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { getFiles, getFolders } from "@features/files/api";
import {
  createGenerationTask,
  getGenerationOptions,
  type VisualCanvasGenerationDraft,
} from "@features/visual-workshop/api";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import { usePromptVersions } from "@features/visual-workshop/generation/usePromptVersions";
import { cloneCanvasSelection } from "@features/visual-workshop/canvas/canvasClipboard";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getGenerationOptions: vi.fn(),
  createGenerationTask: vi.fn(),
}));

const initial: VisualCanvasGenerationDraft = {
  model_id: "model-video",
  prompt: "第二版",
  prompt_versions: [
    { id: "one", name: "v1", prompt: "第一版" },
    { id: "two", name: "v2", prompt: "第二版" },
  ],
  active_prompt_version_id: "two",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(createGenerationTask).mockResolvedValue({
    id: "task",
    project_id: "project",
    canvas_node_id: "node",
    provider_id: "provider",
    model_id: "model-video",
    provider_kind: "volcengine_video",
    kind: "video",
    provider_name: "Test",
    model_slug: "test-model",
    request_payload: {},
    provider_task_id: null,
    status: "queued",
    progress: 0,
    error_message: null,
    result_asset_id: null,
    can_retry_materialization: false,
    revision: 0,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    completed_at: null,
  });
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: (["image", "video", "audio"] as const).map((kind) => ({
      id: `model-${kind}`,
      provider_id: "provider",
      provider_name: "Test",
      kind,
      slug: kind === "audio" ? "music-test" : "test-model",
      label: `Test ${kind}`,
      description: "",
      sizes: ["1024x1024"],
      max_reference_images: 9,
      supports_seed: true,
      max_prompt_length: 6000,
    })),
  });
});

function mount(
  kind: "image" | "video" | "audio",
  prepare = vi.fn(async () => 5),
) {
  const saved = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState<VisualCanvasGenerationDraft>({
      ...initial,
      model_id: `model-${kind}`,
    });
    return (
      <GenerationDrawer
        compact
        layout="workbench"
        lockedKind={kind}
        projectId="project"
        canvasNodeId="node"
        draft={draft}
        onDraftChange={(next, immediate) => {
          saved(next, immediate);
          setDraft(next);
        }}
        onBeforeSubmit={prepare}
        onClose={() => {}}
      />
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
    saved,
    prepare,
  };
}

function editor(kind: "image" | "video" | "audio") {
  return screen.getByRole("textbox", {
    name:
      kind === "image"
        ? "图片提示词"
        : kind === "video"
          ? "视频提示词"
          : "音频提示词",
  });
}
function write(kind: "image" | "video" | "audio", value: string) {
  const target = editor(kind);
  if (kind === "audio") fireEvent.change(target, { target: { value } });
  else {
    target.textContent = value;
    fireEvent.input(target);
  }
}
function text(kind: "image" | "video" | "audio") {
  const target = editor(kind);
  return kind === "audio"
    ? (target as HTMLTextAreaElement).value
    : target.textContent;
}
async function select(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "提示词版本" }));
  await userEvent.click(screen.getByRole("option", { name, exact: true }));
}

test.each(["image", "video", "audio"] as const)(
  "%s variants independently save edits, manage versions and submit current text",
  async (kind) => {
    const { saved } = mount(kind);
    await screen.findByText(`Test ${kind}`, {
      selector: "summary span, summary, .video-model-menu button",
    });
    write(kind, "第二版新内容");
    await select("v1");
    expect(text(kind)).toBe("第一版");
    expect(saved.mock.lastCall?.[0].prompt_versions[1].prompt).toBe(
      "第二版新内容",
    );
    write(kind, "第一版新内容");
    await userEvent.click(
      screen.getByRole("button", { name: "复制提示词版本" }),
    );
    expect(text(kind)).toBe("第一版新内容");
    expect(saved.mock.lastCall?.[1]).toBe(true);
    await userEvent.click(
      screen.getByRole("button", { name: "重命名提示词版本" }),
    );
    const dialog = screen.getByRole("dialog", { name: "重命名提示词版本" });
    await userEvent.clear(within(dialog).getByLabelText("版本名称"));
    await userEvent.type(within(dialog).getByLabelText("版本名称"), "舞蹈方案");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认", exact: true }),
    );
    expect(createGenerationTask).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "新增提示词版本" }),
    );
    expect(text(kind)).toBe("");
    await userEvent.click(
      screen.getByRole("button", { name: "删除提示词版本" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "删除版本", exact: true }),
    );
    await select("v2");
    expect(text(kind)).toBe("第二版新内容");
    // Submit through the form to cover audio's text-only submit button too.
    fireEvent.submit(editor(kind).closest("form")!);
    await waitFor(() => expect(createGenerationTask).toHaveBeenCalled());
    expect(vi.mocked(createGenerationTask).mock.calls[0][1]).toMatchObject({
      kind,
      prompt: "第二版新内容",
      expected_canvas_revision: 5,
    });
    expect(saved.mock.lastCall?.[0].model_id).toBe(`model-${kind}`);
  },
);

test.each(["image", "video", "audio"] as const)(
  "%s does not submit after a failed or conflicting save",
  async (kind) => {
    const prepare = vi.fn(async () => {
      throw new Error("画布存在保存冲突");
    });
    mount(kind, prepare);
    await waitFor(() => expect(getGenerationOptions).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.submit(editor(kind).closest("form")!);
    await waitFor(() =>
      expect(screen.getByText(/画布存在保存冲突/)).toBeInTheDocument(),
    );
    expect(createGenerationTask).not.toHaveBeenCalled();
    expect(text(kind)).toBe("第二版");
  },
);

test("synchronous edits and switching do not depend on React renders or an old blur closure", () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(
    ({ draft }) => usePromptVersions(draft, save),
    { initialProps: { draft: initial } },
  );
  const oldRead = result.current.read;
  act(() => {
    result.current.edit("刚输入");
    result.current.select("one");
    result.current.edit("另一版");
    result.current.select("two");
  });
  expect(oldRead().prompt).toBe("刚输入");
  expect(oldRead().prompt_versions.map((version) => version.prompt)).toEqual([
    "另一版",
    "刚输入",
  ]);
  // Undo/server replacement must update the editor instead of writing local state back.
  const reset = {
    ...initial,
    active_prompt_version_id: "one",
    prompt: "第一版",
  };
  rerender({ draft: reset });
  expect(result.current.prompt).toBe("第一版");
  expect(save).toHaveBeenCalledTimes(4);
});

test("the last version cannot be deleted and the twenty-version limit disables creation", async () => {
  const save = vi.fn();
  const { result } = renderHook(() => usePromptVersions(undefined, save));
  act(() => result.current.remove("v1"));
  expect(result.current.prompt_versions).toHaveLength(1);
  act(() => {
    for (let i = 0; i < 22; i++) result.current.add();
  });
  expect(result.current.prompt_versions).toHaveLength(20);
});

test("copied nodes retain independent variants and active selection", () => {
  const original = {
    id: "node",
    title: "节点",
    kind: "video" as const,
    position: { x: 0, y: 0 },
    generation_draft: structuredClone(initial),
  };
  const copy = cloneCanvasSelection(
    { nodes: [original], edges: [], origin: { x: 0, y: 0 } },
    { x: 300, y: 300 },
  );
  expect(copy.nodes[0].kind).toBe("video");
  if (copy.nodes[0].kind !== "video") throw new Error("节点类型变化");
  expect(copy.nodes[0].generation_draft).toEqual(initial);
  copy.nodes[0].generation_draft!.prompt_versions![0].prompt = "副本修改";
  expect(original.generation_draft.prompt_versions![0].prompt).toBe("第一版");
});
