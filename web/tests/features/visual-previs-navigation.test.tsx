import { useImperativeHandle, type Ref } from "react";
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
import PrevisWorkspace from "@features/visual-workshop/previs/PrevisWorkspace";
import { deletePrevis, listPrevis } from "@features/visual-workshop/previs/api";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { guardedNavigation } from "@shared/ui/navigationGuards";

const { requestLeave } = vi.hoisted(() => ({ requestLeave: vi.fn() }));
vi.mock("@features/visual-workshop/previs/api", () => ({
  listPrevis: vi.fn(),
  openPrevis: async () => ({
    id: "scene",
    title: "预演场景一",
    revision: 0,
    document: { objects: [] },
  }),
  createPrevis: vi.fn(),
  deletePrevis: vi.fn(),
}));
vi.mock("@features/visual-workshop/previs/PrevisEditor", () => ({
  PrevisEditor: ({
    ref,
  }: {
    ref: Ref<{ requestLeave: () => Promise<boolean> }>;
  }) => {
    useImperativeHandle(ref, () => ({ requestLeave }));
    return <p>场景编辑就绪</p>;
  },
}));
vi.mock("@features/visual-workshop/previs/ScriptPrevisDraft", () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <section aria-label="从剧本创建预演">
      <button onClick={onCancel}>取消创建</button>
    </section>
  ),
}));

beforeEach(() => {
  requestLeave.mockReset();
  vi.mocked(listPrevis)
    .mockReset()
    .mockResolvedValue([
      {
        id: "scene",
        title: "预演场景一",
        revision: 0,
        updated_at: "2026-11-22T00:00:00Z",
      },
    ]);
  vi.mocked(deletePrevis).mockReset().mockResolvedValue({ deleted: true });
});

async function openWorkspace(readOnly = false, selectScene = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NavigationProtection>
        <PrevisWorkspace
          projectId="project"
          readOnly={readOnly}
          onBack={() => guardedNavigation(navigate)}
        />
        <button onClick={() => guardedNavigation(navigate)}>其他页面</button>
      </NavigationProtection>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "展开场景侧栏" }));
  const scene = await screen.findByRole("button", { name: "预演场景一" });
  if (selectScene) {
    fireEvent.click(scene);
    await screen.findByText("场景编辑就绪");
  }
  return navigate;
}

test("defers application navigation until the scene's existing leave rule succeeds", async () => {
  const navigate = await openWorkspace();
  let saved: (allowed: boolean) => void = () => {};
  requestLeave.mockReturnValue(
    new Promise<boolean>((resolve) => {
      saved = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "其他页面" }));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => saved(true));
  expect(navigate).toHaveBeenCalledOnce();
  requestLeave.mockResolvedValue(true);
  // The header already runs the leave rule; its callback must not be guarded twice.
  fireEvent.click(screen.getByRole("button", { name: "返回项目" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  expect(requestLeave).toHaveBeenCalledTimes(2);
});

test("a blocked or failed scene save keeps navigation on the editor", async () => {
  const navigate = await openWorkspace();
  requestLeave.mockResolvedValue(false);
  fireEvent.click(screen.getByRole("button", { name: "其他页面" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "返回项目" })).toBeEnabled(),
  );
  expect(navigate).not.toHaveBeenCalled();
  requestLeave.mockRejectedValue(new Error("场景保存失败"));
  fireEvent.click(screen.getByRole("button", { name: "其他页面" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("场景保存失败");
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByText("场景编辑就绪")).toBeVisible();
});

test("script creation in the add menu respects scene saving and cancellation restores the trigger", async () => {
  await openWorkspace();
  const add = screen.getByRole("button", { name: "添加预演场景" });
  expect(
    screen.queryByRole("button", { name: "从剧本创建" }),
  ).not.toBeInTheDocument();
  requestLeave.mockResolvedValue(false);
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("menuitem", { name: "从剧本创建" }));
  await waitFor(() => expect(requestLeave).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("region", { name: "从剧本创建预演" }),
  ).not.toBeInTheDocument();
  requestLeave.mockResolvedValue(true);
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("menuitem", { name: "从剧本创建" }));
  await screen.findByRole("region", { name: "从剧本创建预演" });
  fireEvent.click(screen.getByRole("button", { name: "取消创建" }));
  await waitFor(() => expect(add).toHaveFocus());
  expect(screen.getByText("场景编辑就绪")).toBeVisible();
});

test("blank scene creation uses the existing leave rule", async () => {
  await openWorkspace();
  requestLeave.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "添加预演场景" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "新建空白场景" }));
  await screen.findByRole("textbox", { name: "场景名称" });
  expect(requestLeave).toHaveBeenCalledOnce();
  expect(screen.queryByText("场景编辑就绪")).not.toBeInTheDocument();
});

test("readonly scenes have no creation menu", async () => {
  await openWorkspace(true);
  expect(
    screen.queryByRole("button", { name: "添加预演场景" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^删除场景/ })).toBeNull();
});

test("scene deletion uses an application confirmation and cancellation restores focus", async () => {
  await openWorkspace(false, false);
  const remove = screen.getByRole("button", { name: "删除场景 预演场景一" });
  fireEvent.click(remove);
  const dialog = screen.getByRole("alertdialog", {
    name: "删除预演场景“预演场景一”？",
  });
  expect(dialog).toHaveTextContent("已发送的画布素材会保留。");
  expect(deletePrevis).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(deletePrevis).not.toHaveBeenCalled();
});

test("scene deletion keeps the dialog on failure and prevents duplicate requests while retrying", async () => {
  await openWorkspace(false, false);
  vi.mocked(deletePrevis).mockRejectedValueOnce(new Error("删除失败"));
  fireEvent.click(screen.getByRole("button", { name: "删除场景 预演场景一" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^删除$/ }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "删除失败",
  );
  let finish: () => void = () => {};
  vi.mocked(deletePrevis).mockImplementationOnce(
    () =>
      new Promise<{ deleted: boolean }>((resolve) => {
        finish = () => resolve({ deleted: true });
      }),
  );
  vi.mocked(listPrevis).mockResolvedValue([]);
  fireEvent.click(within(dialog).getByRole("button", { name: /^删除$/ }));
  expect(
    within(dialog).getByRole("button", { name: "处理中…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(deletePrevis).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "预演场景一" })).toBeNull();
});
