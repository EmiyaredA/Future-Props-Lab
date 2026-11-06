import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegrationInteractions } from "@features/integrations/IntegrationInteractions";
import { IntegrationModal } from "@features/integrations/components";
import type { NavigationGuard } from "@features/integrations/interaction";

test("a navigation received during submit resumes after successful form closure", async () => {
  let guard: NavigationGuard | null = null;
  const client = new QueryClient();
  const register = (value: NavigationGuard | null) => {
    guard = value;
  };
  const fixture = (visible: boolean) => (
    <QueryClientProvider client={client}>
      <IntegrationInteractions registerNavigationGuard={register}>
        {visible && (
          <IntegrationModal title="提交中" onClose={vi.fn()} protect pending>
            <input aria-label="名称" defaultValue="保留输入" />
          </IntegrationModal>
        )}
      </IntegrationInteractions>
    </QueryClientProvider>
  );
  const view = render(fixture(true));
  const proceed = vi.fn();
  expect(guard).not.toBeNull();
  act(() => {
    expect(guard?.(proceed)).toBe(true);
  });
  expect(proceed).not.toHaveBeenCalled();
  view.rerender(fixture(false));
  await waitFor(() => expect(proceed).toHaveBeenCalledOnce());
  expect(guard).toBeNull();
});

test("failed submit retains the draft and requires resolving deferred navigation", async () => {
  let guard: NavigationGuard | null = null;
  const client = new QueryClient();
  const register = (value: NavigationGuard | null) => {
    guard = value;
  };
  const close = vi.fn();
  const fixture = (pending: boolean) => (
    <QueryClientProvider client={client}>
      <IntegrationInteractions registerNavigationGuard={register}>
        <IntegrationModal
          title="配置"
          onClose={close}
          protect
          pending={pending}
        >
          <input aria-label="名称" defaultValue="原名称" />
        </IntegrationModal>
      </IntegrationInteractions>
    </QueryClientProvider>
  );
  const view = render(fixture(false));
  expect(guard).toBeNull();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "草稿");
  view.rerender(fixture(true));
  const proceed = vi.fn();
  act(() => {
    guard?.(proceed);
  });
  view.rerender(fixture(false));
  await screen.findByRole("alertdialog");
  expect(screen.getByRole("textbox")).toHaveValue("原名称草稿");
  expect(proceed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(close).not.toHaveBeenCalled();
  expect(proceed).not.toHaveBeenCalled();
});
