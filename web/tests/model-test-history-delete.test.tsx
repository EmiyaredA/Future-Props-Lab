import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ModelTestPage } from "@features/models/conversation";
import {
  deleteModelTestConversation,
  getModelTestConversation,
  getModelTestConversations,
  type ModelTestConversationSummary,
} from "@features/models/api";

vi.mock("@features/models/api", async (load) => ({
  ...(await load<typeof import("@features/models/api")>()),
  getCatalog: vi.fn().mockResolvedValue({ providers: [], revision: 1 }),
  getModelTestConversations: vi.fn(),
  getModelTestConversation: vi.fn(),
  deleteModelTestConversation: vi.fn(),
}));

const first: ModelTestConversationSummary = {
  id: "current",
  title: "当前测试对话",
  model_id: null,
  model_slug: "",
  revision: 2,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
};
const second = { ...first, id: "older", title: "历史测试对话", revision: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  let items = [first, second];
  vi.mocked(getModelTestConversations).mockImplementation(async () => ({
    items,
  }));
  vi.mocked(getModelTestConversation).mockImplementation(async (id) => ({
    ...(id === first.id ? first : second),
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [],
  }));
  vi.mocked(deleteModelTestConversation).mockImplementation(async (id) => {
    items = items.filter((item) => item.id !== id);
    return { deleted: true };
  });
});

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ModelTestPage />
    </QueryClientProvider>,
  );
}

async function openDeletion(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  // jsdom does not evaluate hover/focus-within; browser tests cover visibility.
  screen.getByRole("button", { name: `删除对话「${title}」` }).focus();
  await user.keyboard("{Enter}");
}

test("deleting an inactive history row requires confirmation and preserves the active conversation and draft", async () => {
  const user = userEvent.setup();
  renderPage();
  const activeTitle = await screen.findByRole("textbox", { name: "对话标题" });
  await user.type(
    screen.getByPlaceholderText("输入要测试的问题"),
    "尚未发送的草稿",
  );
  await openDeletion(user, "历史测试对话");
  const dialog = screen.getByRole("alertdialog", { name: "删除测试对话" });
  expect(dialog).toHaveTextContent("历史测试对话");
  expect(activeTitle).toHaveValue("当前测试对话");
  expect(deleteModelTestConversation).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(deleteModelTestConversation).not.toHaveBeenCalled();
  await openDeletion(user, "历史测试对话");
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除对话",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(deleteModelTestConversation).toHaveBeenCalledExactlyOnceWith(
    "older",
    5,
  );
  expect(
    screen.queryByRole("button", { name: "删除对话「历史测试对话」" }),
  ).toBeNull();
  expect(activeTitle).toHaveValue("当前测试对话");
  expect(screen.getByPlaceholderText("输入要测试的问题")).toHaveValue(
    "尚未发送的草稿",
  );
  expect(getModelTestConversation).not.toHaveBeenCalledWith("older");
});

test("deleting the active row selects a remaining conversation", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("textbox", { name: "对话标题" });
  await openDeletion(user, "当前测试对话");
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除对话",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "对话标题" })).toHaveValue(
      "历史测试对话",
    ),
  );
  expect(deleteModelTestConversation).toHaveBeenCalledExactlyOnceWith(
    "current",
    2,
  );
});

test("deletion failure stays visible in the confirmation and preserves both rows", async () => {
  const user = userEvent.setup();
  vi.mocked(deleteModelTestConversation).mockRejectedValueOnce(
    new Error("版本已更新，请刷新后重试"),
  );
  renderPage();
  await screen.findByRole("textbox", { name: "对话标题" });
  await openDeletion(user, "历史测试对话");
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "删除对话" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "版本已更新",
  );
  expect(deleteModelTestConversation).toHaveBeenCalledOnce();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(
    screen.getByRole("button", { name: "删除对话「历史测试对话」" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "对话标题" })).toHaveValue(
    "当前测试对话",
  );
});
