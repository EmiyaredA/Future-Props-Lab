import { createRef } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import {
  PrevisEditor,
  type PrevisEditorHandle,
} from "@features/visual-workshop/previs/PrevisEditor";
import { ApiError } from "@platform/api/errors";
import {
  openPrevis,
  savePrevis,
  type PrevisScene,
} from "@features/visual-workshop/previs/api";
import {
  makePrevisBatch,
  publishPrevisBatch,
  type PrevisBatch,
} from "@features/visual-workshop/previs/publication";
import type {
  TrumanHostProps,
  SceneExport,
} from "../../vendor/toonflow/trumanHost";

const host = vi.hoisted(() => ({ props: null as TrumanHostProps | null }));
vi.mock("../../vendor/toonflow/trumanHost", () => ({
  validateScene: (document: unknown) => document,
  mountTrumanMap: (_root: HTMLElement, props: TrumanHostProps) => {
    host.props = props;
    return {
      update: (next: TrumanHostProps) => {
        host.props = next;
      },
      dispose: vi.fn(),
      isBusy: () => false,
    };
  },
}));
vi.mock("@features/visual-workshop/previs/projectModels", () => ({
  projectModelsKey: (project: string) => ["project-models", project],
  getProjectModels: async () => [],
}));
vi.mock("@features/visual-workshop/creative/api", () => ({
  cardsKey: ["cards"],
  listCards: async () => [],
}));
vi.mock("@features/visual-workshop/previs/api", () => ({
  openPrevis: vi.fn(),
  savePrevis: vi.fn(),
}));
vi.mock("@features/visual-workshop/previs/publication", () => ({
  makePrevisBatch: vi.fn(),
  publishPrevisBatch: vi.fn(),
}));

const scene = {
  id: "scene",
  title: "本地场景",
  revision: 0,
  format_version: 1,
  document: { objects: [] },
} as unknown as PrevisScene;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openPrevis).mockResolvedValue({
    ...scene,
    title: "服务器场景",
    revision: 2,
  });
});
function setup() {
  const ref = createRef<PrevisEditorHandle>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (leaving: boolean) => (
    <QueryClientProvider client={client}>
      <PrevisEditor
        ref={ref}
        initial={scene}
        project="project"
        readOnly={false}
        leaving={leaving}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onPublished={vi.fn()}
      />
    </QueryClientProvider>
  );
  const rendered = render(view(false));
  return { ref, rerenderLeaving: () => rendered.rerender(view(true)) };
}

test("reloading a conflicted scene requires an application decision and cancellation keeps the local draft", async () => {
  vi.mocked(savePrevis).mockRejectedValue(new ApiError("场景冲突", {}, 409));
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "场景名称" }), {
    target: { value: "未保存草稿" },
  });
  act(() => host.props?.onSave());
  const reload = await screen.findByRole("button", { name: "载入服务器版本" });
  fireEvent.click(reload);
  const confirmation = screen.getByRole("alertdialog", {
    name: "载入服务器版本？",
  });
  expect(openPrevis).not.toHaveBeenCalled();
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "保留草稿" }),
  );
  expect(screen.getByRole("textbox", { name: "场景名称" })).toHaveValue(
    "未保存草稿",
  );
  fireEvent.click(reload);
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "载入服务器版本",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "场景名称" })).toHaveValue(
      "服务器场景",
    ),
  );
  expect(openPrevis).toHaveBeenCalledOnce();
});

test("pending material delivery has a cancellable leave decision even while the parent awaits navigation", async () => {
  vi.mocked(makePrevisBatch).mockResolvedValue({
    scene,
    published: 1,
    remaining: [{}],
  } as PrevisBatch);
  vi.mocked(publishPrevisBatch).mockRejectedValue(new Error("交付中断"));
  const { ref, rerenderLeaving } = setup();
  await act(async () => {
    await host
      .props!.exportCanvas!.deliver(
        {} as SceneExport,
        new AbortController().signal,
      )
      .catch(() => undefined);
  });
  rerenderLeaving();
  let leave!: Promise<boolean>;
  act(() => {
    leave = ref.current!.requestLeave();
  });
  const confirmation = screen.getByRole("alertdialog", {
    name: "离开预演场景？",
  });
  expect(confirmation).toHaveTextContent("已发送的素材会保留");
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "留在场景" }),
  );
  expect(await leave).toBe(false);
  expect(savePrevis).not.toHaveBeenCalled();
  act(() => {
    leave = ref.current!.requestLeave();
  });
  fireEvent.click(screen.getByRole("button", { name: "舍弃并离开" }));
  expect(await leave).toBe(true);
});
