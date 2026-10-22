import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { RunsPane } from "@features/visual-workshop/acceptance/RunsPane";
import { RunReview } from "@features/visual-workshop/acceptance/RunReview";
import { ReferenceMaterials } from "@features/visual-workshop/acceptance/ReferenceMaterials";
import type { Standard } from "@features/visual-workshop/acceptance/api";
import type { VisualNodeOutput } from "@features/visual-workshop/api";
import { acceptanceRun } from "./helpers/acceptance";
const mocks = vi.hoisted(() => ({ create: vi.fn(), failedBlob: false }));
vi.mock("@features/visual-workshop/acceptance/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getModels: async () => ({ items: [] }),
  getRuns: async () => ({ items: [] }),
  createRuns: mocks.create,
}));
vi.mock("@features/visual-workshop/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getNodeOutputs: async () => ({
    items: [
      {
        id: "output",
        node_id: "node",
        version: 2,
        is_final: false,
        source: "uploaded",
      },
    ],
    total: 1,
  }),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({
    url: "",
    loading: false,
    error: mocks.failedBlob ? Error("missing") : null,
  }),
}));
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
const act = async <T,>(action: () => Promise<T>) => action();
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  mocks.failedBlob = false;
  mocks.create.mockReset();
});
test("unavailable vision model disables submission without downgrading inspection", async () => {
  const run = acceptanceRun();
  const document = {
    title: "标准",
    node_ids: [],
    criteria: run.snapshot.criteria,
  };
  const standard: Standard = {
    project_id: "project",
    required: true,
    revision: 1,
    published_version: 1,
    draft: document,
    published: document,
  };
  render(
    <RunsPane
      projectId="project"
      nodes={[]}
      standard={standard}
      writable
      busy={false}
      act={act}
      repairs={{}}
      onRepair={vi.fn()}
      onAdopt={vi.fn()}
      onBack={vi.fn()}
      onViewStandard={vi.fn()}
      initialOutput={{ id: "output", node_id: "node" } as VisualNodeOutput}
    />,
    { wrapper },
  );
  await waitFor(() =>
    expect(screen.getByText(/暂无可用视觉模型/)).toBeVisible(),
  );
  expect(screen.getByRole("button", { name: "开始验收（1）" })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
});
test("failed execution surfaces the error and requires an explicit retry", async () => {
  const user = userEvent.setup(),
    onRecheck = vi.fn();
  const run = acceptanceRun({
    status: "failed",
    error_message: "模型返回了未知证据",
    results: [],
  });
  render(
    <RunReview
      projectId="project"
      run={run}
      repairs={{}}
      writable
      busy={false}
      act={act}
      onRepair={vi.fn()}
      onAdopt={vi.fn()}
      onOpenRun={vi.fn()}
      onBack={vi.fn()}
      onViewStandard={vi.fn()}
      onUpdate={vi.fn()}
      onRecheck={onRecheck}
    />,
    { wrapper },
  );
  expect(screen.getByRole("alert")).toHaveTextContent("模型返回了未知证据");
  expect(
    screen.queryByRole("button", { name: "设为最终输出" }),
  ).not.toBeInTheDocument();
  expect(onRecheck).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "重新验收" }));
  expect(onRecheck).toHaveBeenCalledWith(run);
});
test("unavailable bound reference remains visible and can be removed", () => {
  mocks.failedBlob = true;
  render(
    <ReferenceMaterials
      ids={["missing"]}
      nodes={[]}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText("不可读取")).toBeVisible();
  expect(screen.getByText("固定素材")).toBeVisible();
  expect(screen.getByRole("button", { name: "解除参考 1" })).toBeEnabled();
});
