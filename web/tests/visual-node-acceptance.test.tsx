import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { NodeAcceptancePanel } from "@features/visual-workshop/acceptance/NodeAcceptancePanel";
import { ReadonlyTemplates } from "@features/visual-workshop/acceptance/ReadonlyTemplates";
import { ProjectAcceptanceSummary } from "@features/visual-workshop/acceptance/ProjectAcceptanceSummary";
import type {
  AcceptanceCatalog,
  NodeAcceptance,
} from "@features/visual-workshop/acceptance/nodeApi";
import { acceptanceRun } from "./helpers/acceptance";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  select: vi.fn(),
  start: vi.fn(),
  writable: true,
}));
const catalog: AcceptanceCatalog = {
  items: [
    {
      id: "builtin:motion-transfer",
      title: "动作迁移",
      readonly: true,
      version: 1,
      kinds: ["video"],
      criteria: [],
      schemes: ["api", "codex", "claude-code"].map((id) => ({
        id: `motion-transfer:${id}` as "motion-transfer:api",
        provider_kind: "openai",
        version: 1,
        title: id === "api" ? "模型 API 方案" : `${id} 方案`,
        kind: id === "api" ? "model_api" : "code_agent",
        available: true,
        message: "已配置",
        connection_label: id === "api" ? "视觉模型 · 测试连接" : id,
        model_slug: "vision-model-id",
        input_description: "自动读取角色图、参考视频",
        output_description: "逐项建议与证据",
      })),
    },
  ],
};
vi.mock("@features/visual-workshop/acceptance/nodeApi", async (original) => ({
  ...(await original<object>()),
  getAcceptanceCatalog: async () => catalog,
  getNodeAcceptance: mocks.context,
  selectAcceptanceScheme: mocks.select,
  startNodeAcceptance: mocks.start,
}));
vi.mock("@platform/auth/WorkspacePermissions", () => ({
  useWorkspacePermission: () => mocks.writable,
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "", loading: false, error: null }),
}));
vi.mock("@features/visual-workshop/acceptance/NodeRunReview", () => ({
  NodeRunReview: () => <p>已进入验收结果</p>,
}));
const value: NodeAcceptance = {
  node_id: "shot",
  revision: 1,
  scheme_id: "motion-transfer:api",
  output_id: "output",
  output_version: 2,
  canvas_revision: 5,
  context_fingerprint: "a".repeat(64),
  input_source: "generation_snapshot",
  prompt: "实际提交的镜头要求",
  specifications: {},
  result_is_current: false,
  issues: [],
  inputs: [],
};
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue(value);
  mocks.start.mockReset().mockResolvedValue(acceptanceRun());
  mocks.select.mockReset();
  mocks.writable = true;
});

test("fixed templates expose the three connections without editable configuration", () => {
  render(<ReadonlyTemplates catalog={catalog} />);
  expect(screen.getByText("只读")).toBeVisible();
  expect(screen.getAllByText("固定接入")).toHaveLength(3);
  expect(screen.getAllByText("vision-model-id")).toHaveLength(3);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /新建|复制|编辑|连接/ }),
  ).not.toBeInTheDocument();
});

test("node starts with frozen context and an idempotency key without requesting duplicate inputs", async () => {
  const prepare = vi.fn().mockResolvedValue(5);
  render(
    <NodeAcceptancePanel
      projectId="project"
      nodeId="shot"
      prepareCanvas={prepare}
      onGeneration={vi.fn()}
    />,
    { wrapper },
  );
  await screen.findByText("实际提交的镜头要求");
  expect(screen.getByText("来自该输出生成时的资料快照")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "开始验收 v2" }));
  await screen.findByText("已进入验收结果");
  expect(prepare).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(
    "project",
    "shot",
    expect.objectContaining({
      expected_revision: 1,
      expected_canvas_revision: 5,
      context_fingerprint: "a".repeat(64),
      output_id: "output",
      request_id: expect.any(String),
    }),
  );
});

test("changed inputs require another explicit submission and missing inputs lead back to generation", async () => {
  mocks.context
    .mockResolvedValueOnce(value)
    .mockResolvedValue({ ...value, context_fingerprint: "b".repeat(64) });
  const onGeneration = vi.fn();
  const view = render(
    <NodeAcceptancePanel
      projectId="project"
      nodeId="shot"
      onGeneration={onGeneration}
    />,
    { wrapper },
  );
  await screen.findByText("实际提交的镜头要求");
  await userEvent.click(screen.getByRole("button", { name: "开始验收 v2" }));
  await screen.findByText(/节点资料已变化/);
  expect(mocks.start).not.toHaveBeenCalled();
  view.unmount();
  mocks.context.mockResolvedValue({ ...value, issues: ["缺少角色基准图"] });
  render(
    <NodeAcceptancePanel
      projectId="project"
      nodeId="shot"
      onGeneration={onGeneration}
    />,
    { wrapper },
  );
  await screen.findByText("缺少角色基准图");
  expect(screen.getByRole("button", { name: "开始验收 v2" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "返回生成设置" }));
  expect(onGeneration).toHaveBeenCalledOnce();
});

test("summary separates current output from final output and opens its node", async () => {
  const open = vi.fn();
  render(
    <ProjectAcceptanceSummary
      catalog={catalog}
      summary={{
        items: [
          {
            node_id: "shot",
            title: "动作镜头",
            kind: "video",
            output_id: "new",
            output_version: 3,
            final_version: 1,
            state: "failed",
            issue: "道具接触异常",
          },
        ],
      }}
      onOpenNode={open}
    />,
  );
  expect(screen.getByText("v3")).toBeVisible();
  expect(screen.getByText("v1")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "打开节点" }));
  expect(open).toHaveBeenCalledWith("shot", "new");
});

test("read-only users can inspect but cannot select or start a scheme", async () => {
  mocks.writable = false;
  render(
    <NodeAcceptancePanel
      projectId="project"
      nodeId="shot"
      onGeneration={vi.fn()}
    />,
    { wrapper },
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "开始验收 v2" })).toBeDisabled(),
  );
  expect(mocks.start).not.toHaveBeenCalled();
});

test("explicit read-only browsing disables mutations even with an owner context", async () => {
  mocks.writable = true;
  render(
    <NodeAcceptancePanel
      projectId="project"
      nodeId="shot"
      onGeneration={vi.fn()}
      readOnly
    />,
    { wrapper },
  );
  await screen.findByText("实际提交的镜头要求");
  expect(screen.getByRole("combobox", { name: "选择验收方案" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "开始验收 v2" })).toBeDisabled();
});
