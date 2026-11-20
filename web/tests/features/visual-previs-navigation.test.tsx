import { useImperativeHandle, type Ref } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import PrevisWorkspace from "@features/visual-workshop/previs/PrevisWorkspace";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { guardedNavigation } from "@app/entries/navigation";

const { requestLeave } = vi.hoisted(() => ({ requestLeave: vi.fn() }));
vi.mock("@features/visual-workshop/previs/api", () => ({
  listPrevis: async () => [{ id: "scene", title: "预演场景一" }],
  openPrevis: async () => ({ id: "scene", title: "预演场景一" }),
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

beforeEach(() => {
  requestLeave.mockReset();
});

async function openWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NavigationProtection>
        <PrevisWorkspace
          projectId="project"
          onBack={() => guardedNavigation(navigate)}
        />
        <button onClick={() => guardedNavigation(navigate)}>其他页面</button>
      </NavigationProtection>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "预演场景一" }));
  await screen.findByText("场景编辑就绪");
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
