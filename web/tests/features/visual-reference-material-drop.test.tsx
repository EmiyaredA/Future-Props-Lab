import userEvent from "@testing-library/user-event";
import { useState, type DragEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@platform/api/errors";
import { referenceContentCardIds } from "@features/visual-workshop/generation/referenceContentLinks";
import {
  importManagedFiles,
  uploadManagedFile,
  type ManagedFile,
} from "@features/files";
import { useProjectReferenceDrop } from "@features/visual-workshop/generation/useProjectReferenceDrop";
import {
  setCanvasAssetDragData,
  readCanvasAssetDragData,
} from "@features/visual-workshop/canvas/canvasAssetDrag";
import {
  listProjectCards,
  type Card,
} from "@features/visual-workshop/creative/api";
import { resolveDesignImage } from "@features/visual-workshop/creative/cardMedia";
import { DesignCardRow } from "@features/visual-workshop/board/DesignCardRow";

vi.mock("@features/files", async (original) => ({
  ...(await original<typeof import("@features/files")>()),
  importManagedFiles: vi.fn(),
  uploadManagedFile: vi.fn(),
  invalidateFileScope: vi.fn(),
}));
vi.mock("@features/visual-workshop/creative/api", async (original) => ({
  ...(await original<
    typeof import("@features/visual-workshop/creative/api")
  >()),
  listProjectCards: vi.fn(),
}));
vi.mock("@features/visual-workshop/creative/cardMedia", () => ({
  resolveDesignImage: vi.fn(),
}));
vi.mock("@features/visual-workshop/generation/referenceContentLinks", () => ({
  referenceContentCardIds: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: undefined }),
}));

const asset = (id: string, kind: "image" | "video" | "audio" = "image") =>
  ({
    id,
    display_name: id,
    media_kind: kind,
    project_id: "project",
    folder_id: null,
    reference_id: null,
    original_filename: `${id}.png`,
    mime_type: `${kind}/test`,
    byte_size: 10,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-11-22T00:00:00Z",
    updated_at: "2026-11-22T00:00:00Z",
  }) satisfies ManagedFile;
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function dragData(localFiles: File[] = []) {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys(), ...(localFiles.length ? ["Files"] : [])];
    },
    files: localFiles,
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key) ?? "",
    dropEffect: "none",
    effectAllowed: "all",
  } as unknown as DataTransfer;
}
function drop(dataTransfer: DataTransfer) {
  return {
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as DragEvent<HTMLElement>;
}
const registerImage = vi.fn();
function mount(max = 3, disabled = false) {
  const changed = vi.fn();
  const loaded = vi.fn();
  let current!: ReturnType<typeof useProjectReferenceDrop> & {
    values: Record<"image" | "video" | "audio", string[]>;
  };
  function Harness({ targetKey }: { targetKey: string }) {
    const [values, setValues] = useState({
      image: [] as string[],
      video: [] as string[],
      audio: [] as string[],
    });
    const drop = useProjectReferenceDrop({
      projectId: "project",
      targetKey,
      files: [],
      onFilesLoaded: loaded,
      registerImage,
      selections: (["image", "video", "audio"] as const).map((kind) => ({
        kind,
        value: values[kind],
        max,
        multiple: true,
        disabled,
        onChange: (ids, design) => {
          changed(kind, ids, design);
          setValues((previous) => ({ ...previous, [kind]: ids }));
        },
      })),
    });
    current = { ...drop, values };
    return (
      <>
        {drop.dialogs}
        {drop.feedback}
      </>
    );
  }
  const view = render(<Harness targetKey="shot-a" />, { wrapper: Wrapper });
  return {
    ...view,
    rerender: ({ targetKey }: { targetKey: string }) =>
      view.rerender(<Harness targetKey={targetKey} />),
    result: {
      get current() {
        return current;
      },
    },
    changed,
    loaded,
  };
}
async function confirmImages() {
  await userEvent.click(
    (await screen.findAllByRole("combobox", { name: /^素材分类/ }))[0],
  );
  await userEvent.click(screen.getByRole("option", { name: /^人设$/ }));
  await userEvent.click(
    screen.getAllByRole("button", { name: "应用分类到全部" })[0],
  );
  await userEvent.click(screen.getByRole("button", { name: "上传并关联" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjectCards).mockResolvedValue([]);
  vi.mocked(referenceContentCardIds).mockResolvedValue([]);
  registerImage.mockImplementation(async (input) => ({
    card: {
      id: `card-${input.asset_id}`,
      kind: input.kind,
      title: input.title,
      adopted_asset_id: input.asset_id,
      revision: 0,
      archived: false,
    },
    project_card_ids: [`card-${input.asset_id}`],
    revision: 1,
    reused: false,
  }));
});

test("uploads a mixed batch once and accumulates image/video/audio references without losing earlier files", async () => {
  vi.mocked(uploadManagedFile).mockImplementation(async (file) =>
    asset(file.name, file.type.split("/")[0] as "image" | "video" | "audio"),
  );
  const { result, loaded } = mount();
  const data = dragData([
    new File(["a"], "a.png", { type: "image/png" }),
    new File(["b"], "b.png", { type: "image/png" }),
    new File(["v"], "v.mp4", { type: "video/mp4" }),
    new File(["s"], "s.wav", { type: "audio/wav" }),
  ]);
  act(() => {
    result.current.handlers.onDragOver(drop(data));
    result.current.handlers.onDrop(drop(data));
    result.current.handlers.onDrop(drop(data));
  });
  await confirmImages();
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(uploadManagedFile).toHaveBeenCalledTimes(4);
  expect(result.current.values).toEqual({
    image: ["a.png", "b.png"],
    video: ["v.mp4"],
    audio: ["s.wav"],
  });
  expect(loaded).toHaveBeenCalledTimes(4);
  expect(registerImage).toHaveBeenCalledTimes(2);
  expect(result.current.notice).toMatchObject({
    tone: "success",
    message: "已添加 4 项参考素材。",
  });
});

test("keeps successful uploads after a partial failure and rejects unsupported files or excess capacity before upload", async () => {
  vi.mocked(uploadManagedFile)
    .mockRejectedValueOnce(new Error("上传失败"))
    .mockResolvedValue(asset("ok"));
  const { result } = mount(1);
  act(() =>
    result.current.handlers.onDrop(
      drop(
        dragData([
          new File(["bad"], "bad.png", { type: "image/png" }),
          new File(["ok"], "ok.png", { type: "image/png" }),
          new File(["extra"], "extra.png", { type: "image/png" }),
          new File(["text"], "notes.txt", { type: "text/plain" }),
        ]),
      ),
    ),
  );
  await confirmImages();
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(uploadManagedFile).toHaveBeenCalledTimes(2);
  expect(result.current.values.image).toEqual(["ok"]);
  expect(result.current.notice?.tone).toBe("error");
  expect(result.current.notice?.message).toContain("已添加 1 项");
  expect(result.current.notice?.message).toContain("数量上限");
  expect(result.current.notice?.message).toContain("notes.txt");
});

test.each(["library", "cross-project"] as const)(
  "rejects %s drags until they are imported into the project",
  async (importMode) => {
    const { result } = mount();
    const data = dragData();
    setCanvasAssetDragData(data, {
      assetId: "original",
      mediaKind: "image",
      displayName: "原图",
      importMode,
      sourceProjectId: "source-project",
    });
    act(() => result.current.handlers.onDrop(drop(data)));
    expect(importManagedFiles).not.toHaveBeenCalled();
    expect(result.current.values.image).toEqual([]);
    expect(result.current.notice?.message).toContain("请先把素材导入当前项目");
  },
);

test("does not bind a late upload to another shot after navigation", async () => {
  let finish!: (file: ManagedFile) => void;
  vi.mocked(uploadManagedFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender, changed, loaded } = mount();
  act(() =>
    result.current.handlers.onDrop(
      drop(dragData([new File(["a"], "a.png", { type: "image/png" })])),
    ),
  );
  await confirmImages();
  rerender({ targetKey: "shot-b" });
  await act(async () => finish(asset("late")));
  expect(changed).not.toHaveBeenCalled();
  expect(loaded).not.toHaveBeenCalled();
  expect(result.current.values.image).toEqual([]);
  expect(result.current.pending).toBe(false);
});

test("disabled drop targets never upload files", async () => {
  const { result } = mount(3, true);
  act(() =>
    result.current.handlers.onDrop(
      drop(dragData([new File(["a"], "a.png", { type: "image/png" })])),
    ),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(uploadManagedFile).not.toHaveBeenCalled();
  expect(result.current.notice?.message).toContain("当前不可用");
});

test("cancelling classification performs no upload or card registration", async () => {
  const { result } = mount();
  act(() =>
    result.current.handlers.onDrop(
      drop(dragData([new File(["a"], "a.png", { type: "image/png" })])),
    ),
  );
  expect(
    await screen.findByRole("dialog", { name: "上传并加入项目设定" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(uploadManagedFile).not.toHaveBeenCalled();
  expect(registerImage).not.toHaveBeenCalled();
});

test("registration retry retains the uploaded file and original request identity", async () => {
  vi.mocked(uploadManagedFile).mockResolvedValue(asset("uploaded"));
  registerImage.mockRejectedValueOnce(new Error("登记回执丢失"));
  const { result } = mount();
  act(() =>
    result.current.handlers.onDrop(
      drop(dragData([new File(["a"], "a.png", { type: "image/png" })])),
    ),
  );
  await confirmImages();
  const retry = await screen.findByRole("button", { name: "重试 a.png" });
  expect(result.current.values.image).toEqual([]);
  expect(screen.getByText(/文件已保留在当前项目/)).toBeVisible();
  await userEvent.click(retry);
  await waitFor(() =>
    expect(result.current.values.image).toEqual(["uploaded"]),
  );
  expect(uploadManagedFile).toHaveBeenCalledOnce();
  expect(registerImage).toHaveBeenCalledTimes(2);
  expect(registerImage.mock.calls[0][0]).toEqual(
    registerImage.mock.calls[1][0],
  );
});

test("multiple content matches require a card choice before binding and retain the uploaded file", async () => {
  vi.mocked(uploadManagedFile).mockResolvedValue(asset("uploaded"));
  const matches: Card[] = ["第一张卡", "第二张卡"].map((title, index) => ({
    id: `match-${index}`,
    kind: "character",
    title,
    revision: 2,
    adopted_asset_id: `original-${index}`,
    archived: false,
    design: "",
  }));
  vi.mocked(listProjectCards).mockResolvedValue(matches);
  vi.mocked(referenceContentCardIds).mockResolvedValue(
    matches.map((card) => card.id),
  );
  registerImage.mockRejectedValueOnce(
    new ApiError(
      "需要选择",
      {
        code: "reference_image_choice_required",
      },
      409,
    ),
  );
  registerImage.mockResolvedValueOnce({
    card: matches[1],
    reused: true,
    revision: 1,
    project_card_ids: matches.map((card) => card.id),
  });
  const { result, changed } = mount();
  act(() =>
    result.current.handlers.onDrop(
      drop(dragData([new File(["a"], "a.png", { type: "image/png" })])),
    ),
  );
  await confirmImages();
  expect(
    await screen.findByRole("dialog", { name: "选择已有项目设定卡" }),
  ).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "第二张卡" }));
  await userEvent.click(screen.getByRole("button", { name: "确认选择" }));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(uploadManagedFile).toHaveBeenCalledOnce();
  expect(registerImage.mock.calls[1][0]).toMatchObject({
    ...registerImage.mock.calls[0][0],
    reuse_card_id: "match-1",
  });
  expect(changed).toHaveBeenCalledWith(
    "image",
    ["uploaded"],
    expect.objectContaining({ card_id: "match-1" }),
  );
});

test("uncollected design cards cannot be dragged into a project", async () => {
  const { result } = mount();
  const data = dragData();
  setCanvasAssetDragData(data, {
    assetId: "external",
    mediaKind: "image",
    displayName: "外部卡",
    importMode: "library",
    cardId: "outside",
  });
  act(() => result.current.handlers.onDrop(drop(data)));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.notice?.message).toContain(
    "请先将此设定卡收录到当前项目",
  );
  expect(resolveDesignImage).not.toHaveBeenCalled();
});

test("dragging a design row preserves its verified card revision and adopted-image binding", async () => {
  const card: Card = {
    id: "card",
    kind: "character",
    title: "角色",
    revision: 4,
    adopted_asset_id: "adopted",
    archived: false,
    candidate_asset_ids: [],
    candidate_task_ids: [],
    design: "",
    voice_asset_id: null,
    source: null,
    source_project_id: null,
    parent_id: null,
    parent_asset_id: null,
    model_asset_key: null,
    media_projects: { adopted: null },
  };
  vi.mocked(listProjectCards).mockResolvedValue([card]);
  vi.mocked(resolveDesignImage).mockResolvedValue("placed");
  const view = render(
    <DesignCardRow
      card={card}
      label={{ name: "角色" }}
      canUse
      sources={[]}
      onUse={vi.fn()}
      onCanvas={vi.fn()}
      onView={vi.fn()}
      onRemove={vi.fn()}
      onSource={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  const data = dragData();
  fireEvent.dragStart(screen.getByRole("button", { name: "查看设定卡 角色" }), {
    dataTransfer: data,
  });
  expect(readCanvasAssetDragData(data)).toMatchObject({
    cardId: "card",
    assetId: "adopted",
  });
  view.unmount();
  const { result, changed } = mount();
  act(() => result.current.handlers.onDrop(drop(data)));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(changed).toHaveBeenCalledWith("image", ["placed"], {
    card_id: "card",
    card_revision: 4,
    asset_id: "placed",
    title: "角色",
  });
});
