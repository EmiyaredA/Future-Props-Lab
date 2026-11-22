import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import ScriptPrevisDraft from "@features/visual-workshop/previs/ScriptPrevisDraft";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  create: vi.fn(),
  dispose: vi.fn(),
  play: vi.fn(),
}));
vi.mock("@platform/auth/AccountAccess", () => ({
  useAccountPermission: () => true,
}));
vi.mock("@features/visual-workshop/creative/TextModelSelect", () => ({
  TextModelSelect: () => <button aria-label="文本模型">选择文本模型</button>,
}));
vi.mock("@features/visual-workshop/creative/api", () => ({
  scriptKey: (project: string) => ["script", project],
  getScript: async () => ({ revision: 1, episodes: [] }),
}));
vi.mock("@features/visual-workshop/previs/api", () => ({
  createPrevis: mocks.create,
}));
vi.mock("../../vendor/toonflow/trumanScene", () => ({
  createSceneDocument: () => ({ objects: [] }),
}));
vi.mock("../../vendor/toonflow/trumanHost", () => ({
  scriptSetOptions: () => ({
    suggested: "conversation",
    items: [{ id: "conversation", name: "室内对白" }],
  }),
  mountTrumanMap: () => ({
    buildScript: mocks.build,
    update: vi.fn(),
    dispose: mocks.dispose,
    playPreview: mocks.play,
  }),
}));
const source =
  "室内 · 咖啡馆 · 夜\n小林：你终于来了。\n小夏：路上堵车。\n小夏放下杯子。";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.build.mockResolvedValue({
    shots: [{ camera: "分镜·双人全景" }, { camera: "分镜·对话近景" }],
    characters: ["小林", "小夏"],
  });
  mocks.create.mockResolvedValue({ id: "new-scene", title: "咖啡馆" });
});
function setup() {
  const onCreated = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ScriptPrevisDraft
        project="project"
        onCreated={onCreated}
        onCancel={vi.fn()}
        onBusy={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onCreated;
}
test("shows source size and real analysis counts, dialogue and shots before explicit creation", async () => {
  const onCreated = setup();
  const user = userEvent.setup();
  const stats = screen.getByLabelText("解析统计");
  expect(within(stats).getAllByText("—")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "创建白模场景" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "剧本文本" }), {
    target: { value: source },
  });
  expect(screen.getByText(/字 · 4 行/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "规则解析" }));
  await screen.findByText("可创建");
  expect(stats).toHaveTextContent("角色2道具0对白2镜头2");
  expect(screen.getByText("双人全景")).toBeVisible();
  expect(screen.getByText("你终于来了。")).toBeVisible();
  expect(mocks.create).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "播放试排" }));
  expect(mocks.play).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "创建白模场景" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
});
test("editing analyzed input clears stale statistics and blocks stale scene creation", async () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "剧本文本" }), {
    target: { value: source },
  });
  fireEvent.click(screen.getByRole("button", { name: "规则解析" }));
  await screen.findByText("可创建");
  fireEvent.change(screen.getByRole("textbox", { name: "剧本文本" }), {
    target: { value: "室外 · 街道 · 日" },
  });
  expect(screen.getByRole("button", { name: "创建白模场景" })).toBeDisabled();
  expect(
    within(screen.getByLabelText("解析统计")).getAllByText("—"),
  ).toHaveLength(4);
  expect(screen.queryByText("双人全景")).not.toBeInTheDocument();
});
test("failed staging keeps extracted information visible without enabling creation", async () => {
  mocks.build.mockRejectedValueOnce(new Error("试排失败"));
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "剧本文本" }), {
    target: { value: source },
  });
  fireEvent.click(screen.getByRole("button", { name: "规则解析" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("试排失败");
  expect(screen.getByLabelText("解析统计")).toHaveTextContent(
    "角色2道具0对白2镜头—",
  );
  expect(screen.getByRole("button", { name: "创建白模场景" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "规则解析" })).toBeEnabled();
});
