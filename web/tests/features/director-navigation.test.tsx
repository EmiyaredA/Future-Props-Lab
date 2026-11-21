import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { DirectorDeskEditorPage } from "@features/director-desk/DirectorDeskEditorPage";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { guardedNavigation } from "@shared/ui/navigationGuards";

const { mount } = vi.hoisted(() => ({ mount: vi.fn(() => () => {}) }));
vi.mock("@features/director-desk/editor/main", () => ({
  mountDirectorEditor: mount,
}));
vi.mock("@features/director-desk/editor/style.css", () => ({}));
vi.mock("@features/director-desk/api", () => ({
  getDirectorProject: async () => ({
    id: "one",
    title: "工程",
    revision: 0,
    document: {},
  }),
  hydrateDocument: async () => ({}),
  externalizeDocument: vi.fn(),
  patchDirectorProject: vi.fn(),
}));

test("director's explicit editor state protects local navigation and blocks leaving during active work", async () => {
  const navigate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NavigationProtection>
        <DirectorDeskEditorPage projectId="one" onBack={navigate} />
        <button onClick={() => guardedNavigation(navigate)}>切页</button>
      </NavigationProtection>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mount).toHaveBeenCalledOnce());
  const host = (
    mount.mock.calls[0] as unknown as [
      { onNavigationState: (state: { dirty: boolean; busy: boolean }) => void },
    ]
  )[0];
  act(() => host.onNavigationState({ dirty: true, busy: true }));
  fireEvent.click(screen.getByRole("button", { name: "切页" }));
  expect(
    screen.getByRole("alertdialog", { name: "工程尚未保存" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
  expect(navigate).not.toHaveBeenCalled();
  act(() => host.onNavigationState({ dirty: true, busy: false }));
  fireEvent.click(screen.getByRole("button", { name: "留在此页" }));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "切页" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(navigate).toHaveBeenCalledOnce();
});
