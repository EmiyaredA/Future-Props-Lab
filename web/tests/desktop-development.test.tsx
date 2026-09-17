import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopDevelopmentHost } from "../src/app/DesktopDevelopmentHost";
import type { DesktopDevelopmentState } from "@platform/desktop";

let publish: (state: DesktopDevelopmentState) => void;
let menuAction: (action: "apply" | "check") => void;
const state: DesktopDevelopmentState = {
  live: true,
  pending: ["backend"],
  phase: "ready",
  message: "有更新",
  generation: 0,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.futurePropsDesktop = {
    version: 1,
    status: vi.fn(),
    retry: vi.fn(),
    openLogs: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    openNewWindow: vi.fn(),
    agentStatus: vi.fn(),
    enableAgent: vi.fn(),
    disableAgent: vi.fn(),
    onQuitRequested: vi.fn(() => vi.fn()),
    developmentStatus: vi.fn().mockResolvedValue(state),
    applyDevelopmentUpdate: vi.fn(),
    checkDevelopmentUpdate: vi.fn(),
    onDevelopmentState: vi.fn((fn) => {
      publish = fn;
      return vi.fn();
    }),
    onDevelopmentMenuAction: vi.fn((fn) => {
      menuAction = fn;
      return vi.fn();
    }),
  };
});
afterEach(() => {
  delete window.futurePropsDesktop;
  client.clear();
});
function show() {
  const view = render(
    <QueryClientProvider client={client}>
      <DesktopDevelopmentHost />
    </QueryClientProvider>,
  );
  return view;
}

test("development host never injects App chrome", async () => {
  const { container } = show();
  await waitFor(() =>
    expect(window.futurePropsDesktop!.developmentStatus).toHaveBeenCalled(),
  );
  expect(container).toBeEmptyDOMElement();
  act(() => publish({ ...state, pending: ["backend"], message: "有更新" }));
  expect(container).toBeEmptyDOMElement();
});

test("backend update does not navigate or discard drafts", async () => {
  const guard = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("future-props:before-workspace-switch", guard);
  try {
    show();
    await waitFor(() =>
      expect(
        window.futurePropsDesktop!.onDevelopmentMenuAction,
      ).toHaveBeenCalled(),
    );
    act(() => menuAction("apply"));
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).toHaveBeenCalledOnce();
    expect(guard).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("future-props:before-workspace-switch", guard);
  }
});

test.each(["desktop", "page"])(
  "%s update stays pending when unsaved guard cancels",
  async (kind) => {
    show();
    await waitFor(() =>
      expect(
        window.futurePropsDesktop!.onDevelopmentMenuAction,
      ).toHaveBeenCalled(),
    );
    act(() => publish({ ...state, pending: [kind] }));
    const guard = (event: Event) => event.preventDefault();
    window.addEventListener("future-props:before-workspace-switch", guard);
    act(() => menuAction("apply"));
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).not.toHaveBeenCalled();
    window.removeEventListener("future-props:before-workspace-switch", guard);
    act(() => menuAction("apply"));
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).toHaveBeenCalledOnce();
  },
);

test("compile failure offers recheck, not an unsafe apply", async () => {
  show();
  await waitFor(() =>
    expect(
      window.futurePropsDesktop!.onDevelopmentMenuAction,
    ).toHaveBeenCalled(),
  );
  act(() => publish({ ...state, phase: "error" }));
  act(() => menuAction("check"));
  expect(
    window.futurePropsDesktop!.checkDevelopmentUpdate,
  ).toHaveBeenCalledOnce();
  expect(
    window.futurePropsDesktop!.applyDevelopmentUpdate,
  ).not.toHaveBeenCalled();
});

test("restored service refreshes queries but defers active editors", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  show();
  await waitFor(() =>
    expect(window.futurePropsDesktop!.developmentStatus).toHaveBeenCalled(),
  );
  act(() => publish({ ...state, generation: 1 }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ refetchType: "active" }),
  );
  const guard = (event: Event) => event.preventDefault();
  window.addEventListener("future-props:development-query-refresh", guard);
  try {
    act(() => publish({ ...state, generation: 2 }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ refetchType: "none" }),
    );
  } finally {
    window.removeEventListener("future-props:development-query-refresh", guard);
  }
});

test("packaged / ordinary web never attaches development bridge handlers", async () => {
  delete window.futurePropsDesktop;
  const { container } = show();
  expect(container).toBeEmptyDOMElement();
});

test("window apply event uses the same unsaved guard path", async () => {
  show();
  await waitFor(() =>
    expect(window.futurePropsDesktop!.developmentStatus).toHaveBeenCalled(),
  );
  act(() => publish({ ...state, pending: ["page"] }));
  const guard = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("future-props:before-workspace-switch", guard);
  try {
    act(() =>
      window.dispatchEvent(new Event("future-props:development-apply")),
    );
    expect(guard).toHaveBeenCalledOnce();
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("future-props:before-workspace-switch", guard);
  }
});
