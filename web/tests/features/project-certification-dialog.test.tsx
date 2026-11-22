import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectCertification } from "@features/accounts/ProjectCertification";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { api } from "@platform/api/client";

vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  api: { PATCH: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
function mount(official = false) {
  const cache = new QueryClient();
  render(
    <QueryClientProvider client={cache}>
      <AccountAccessProvider
        userId="owner"
        permissions={["content.write", "projects.certify"]}
      >
        <ProjectCertification
          kind="visual"
          project={{
            id: "project",
            title: "《石头门》新宿决战",
            revision: 7,
            is_official: official,
          }}
          queryKey={["projects"]}
        />
      </AccountAccessProvider>
    </QueryClientProvider>,
  );
  return cache;
}
test("certification shows the project and explicit action; cancellation makes no request", async () => {
  mount();
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "标记官方作品" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "标记官方作品" });
  expect(dialog).toHaveTextContent("《石头门》新宿决战");
  expect(
    within(dialog).getByRole("button", { name: "标记为官方" }),
  ).toBeEnabled();
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.PATCH).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});
test("submission preserves CAS, locks dismissal while pending and keeps failures reviewable", async () => {
  let finish!: (value: never) => void;
  vi.mocked(api.PATCH).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "撤销官方标记" }));
  const dialog = screen.getByRole("dialog", { name: "撤销官方标记" });
  await user.click(within(dialog).getByRole("button", { name: "撤销标记" }));
  expect(api.PATCH).toHaveBeenCalledExactlyOnceWith(
    "/v1/account/project-certification/{kind}/{project_id}",
    {
      params: { path: { kind: "visual", project_id: "project" } },
      body: { is_official: false, expected_revision: 7 },
    },
  );
  expect(
    within(dialog).getByRole("button", { name: "保存中…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(dialog).toBeInTheDocument();
  finish({ error: { detail: "保存失败" }, response: { status: 500 } } as never);
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "撤销标记" }),
    ).toBeEnabled(),
  );
});
