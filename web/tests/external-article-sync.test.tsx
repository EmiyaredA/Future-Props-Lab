import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { IntegrationCenterPage } from "@features/integrations/IntegrationCenterPage";
import { ArticleSyncPanel } from "@features/thought-workshop/external-sync/ArticleSyncPanel";
import * as sync from "@features/thought-workshop/external-sync/api";
import * as connections from "@features/integrations/external/api";
import { getNote, type Note } from "@features/thought-workshop/api";
import { ApiError } from "@platform/api/errors";
import type { ReactNode } from "react";

vi.mock("@features/integrations/external/api", () => ({
  getExternalConnections: vi.fn(),
  createExternalConnection: vi.fn(),
  updateExternalConnection: vi.fn(),
  checkExternalConnection: vi.fn(),
  checkExternalTarget: vi.fn(),
}));
vi.mock("@features/thought-workshop/external-sync/api", () => ({
  getArticleSync: vi.fn(),
  bindArticle: vi.fn(),
  previewArticle: vi.fn(),
  submitArticle: vi.fn(),
  unbindArticle: vi.fn(),
  reconcileArticle: vi.fn(),
}));
vi.mock("@features/thought-workshop/api", () => ({ getNote: vi.fn() }));
const connection: connections.ExternalConnection = {
  id: "connection",
  provider: "feishu",
  name: "文章发布",
  app_id: "cli_test",
  enabled: true,
  has_secret: true,
  status: "healthy",
  status_message: "鉴权通过",
  last_checked_at: null,
  revision: 0,
};
const note = { id: "note", revision: 3 } as Note;
const binding = {
  id: "binding",
  connection_id: connection.id,
  url: "https://demo.feishu.cn/docx/abc",
  title: "远端标题",
  revision: 0,
  last_note_revision: null,
  last_synced_at: null,
};
const preview: sync.SyncPreview = {
  preview_id: "preview",
  note_revision: 3,
  local_text: "本地正文",
  remote_text: "原正文",
  target_title: "远端标题",
  first_sync: true,
  remote_changed: false,
  warnings: [],
  blockers: [],
};
function show(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(connections.getExternalConnections).mockResolvedValue({
    items: [connection],
  });
  vi.mocked(sync.getArticleSync).mockResolvedValue({ binding, tasks: [] });
  vi.mocked(getNote).mockResolvedValue(note);
  vi.mocked(sync.previewArticle).mockResolvedValue(preview);
});
test("the connection empty state is platform neutral and provider branding belongs to configuration", async () => {
  const user = userEvent.setup();
  vi.mocked(connections.getExternalConnections).mockResolvedValue({
    items: [],
  });
  show(
    <IntegrationCenterPage
      kind="external-connections"
      canManage
      onKindChange={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "添加你的第一个外部连接" }),
  ).toBeVisible();
  expect(
    document.querySelector('img[src="/providers/feishu-logo.svg"]'),
  ).toBeNull();
  expect(screen.queryByText(/飞书/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加连接" }));
  expect(screen.getByRole("dialog", { name: "添加飞书连接" })).toBeVisible();
  expect(
    document.querySelector('img[src="/providers/feishu-logo.svg"]'),
  ).not.toBeNull();
});

test("saving connection preserves an existing secret and members cannot load configuration", async () => {
  const user = userEvent.setup();
  const view = show(
    <IntegrationCenterPage
      kind="external-connections"
      canManage
      onKindChange={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "管理" }));
  expect(screen.getByLabelText("App Secret")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "保存连接" }));
  await waitFor(() =>
    expect(connections.updateExternalConnection).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ app_secret: "" }),
    ),
  );
  view.unmount();
  vi.mocked(connections.getExternalConnections).mockClear();
  show(
    <IntegrationCenterPage
      kind="external-connections"
      canManage={false}
      onKindChange={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "添加连接" }),
  ).not.toBeInTheDocument();
  expect(connections.getExternalConnections).not.toHaveBeenCalled();
});
test("replacement needs explicit confirmation; Escape dismisses only the confirmation", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  show(<ArticleSyncPanel note={note} close={close} />);
  await user.click(await screen.findByRole("button", { name: "预览并同步" }));
  await user.click(screen.getByRole("button", { name: "确认并同步" }));
  expect(
    screen.getByRole("dialog", { name: "替换飞书整篇正文？" }),
  ).toBeVisible();
  expect(sync.submitArticle).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("dialog", { name: "替换飞书整篇正文？" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认并同步" }));
  await user.click(screen.getByRole("button", { name: "确认替换并同步" }));
  await waitFor(() =>
    expect(sync.submitArticle).toHaveBeenCalledWith(
      note.id,
      "preview",
      expect.any(String),
    ),
  );
});
test("unsupported content blocks submission and remote conflicts show both bodies", async () => {
  const user = userEvent.setup();
  vi.mocked(sync.previewArticle).mockResolvedValue({
    ...preview,
    preview_id: null,
    remote_changed: true,
    blockers: ["正文/第2块：暂不支持画板"],
  });
  show(<ArticleSyncPanel note={note} close={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "预览并同步" }));
  expect(screen.getByText("正文/第2块：暂不支持画板")).toBeVisible();
  expect(screen.getByText("本地正文")).toBeVisible();
  expect(screen.getByText("原正文")).toBeVisible();
  expect(screen.getByRole("button", { name: "确认并同步" })).toBeDisabled();
  expect(sync.submitArticle).not.toHaveBeenCalled();
});
test("a failed submit stays reviewable in the confirmation and preserves the preview", async () => {
  const user = userEvent.setup();
  vi.mocked(sync.submitArticle).mockRejectedValue(
    new Error("飞书内容已变化，请重新预览再确认"),
  );
  show(<ArticleSyncPanel note={note} close={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "预览并同步" }));
  await user.click(screen.getByRole("button", { name: "确认并同步" }));
  await user.click(screen.getByRole("button", { name: "确认替换并同步" }));
  const dialog = screen.getByRole("dialog", { name: "替换飞书整篇正文？" });
  await waitFor(() => expect(dialog).toHaveTextContent("飞书内容已变化"));
  await user.keyboard("{Escape}");
  expect(screen.getByText("本地正文")).toBeVisible();
});
test("a wiki link is checked and bound as the resolved document", async () => {
  const user = userEvent.setup();
  const resolved = "https://my.feishu.cn/docx/doxcnResolved";
  vi.mocked(sync.getArticleSync).mockResolvedValue({
    binding: null,
    tasks: [],
  });
  vi.mocked(connections.checkExternalTarget).mockResolvedValue({
    document_id: "doxcnResolved",
    url: resolved,
    title: "调研",
    text: "正文",
    fingerprint: "fp",
    revision: 1,
    can_write: true,
  });
  vi.mocked(sync.bindArticle).mockResolvedValue({ ...binding, url: resolved });
  show(<ArticleSyncPanel note={note} close={vi.fn()} />);
  await user.click(await screen.findByRole("combobox", { name: "使用连接" }));
  await user.click(screen.getByRole("option", { name: "文章发布" }));
  await user.type(
    screen.getByRole("textbox", { name: "目标文档链接" }),
    "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc?from=wiki",
  );
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  expect(await screen.findByText("调研")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "绑定文档" }));
  await waitFor(() =>
    expect(sync.bindArticle).toHaveBeenCalledWith(
      note.id,
      connection.id,
      resolved,
      0,
    ),
  );
  expect(connections.checkExternalTarget).toHaveBeenCalledWith(
    connection.id,
    "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc?from=wiki",
  );
});
test("a forbidden wiki node links to the document and the app permission page", async () => {
  const user = userEvent.setup();
  vi.mocked(sync.getArticleSync).mockResolvedValue({
    binding: null,
    tasks: [],
  });
  vi.mocked(connections.checkExternalTarget).mockRejectedValue(
    new ApiError(
      "应用还不能读取这篇知识库文档（错误码 131006）。",
      { code: "wiki_node_forbidden" },
      502,
    ),
  );
  show(<ArticleSyncPanel note={note} close={vi.fn()} />);
  await user.click(await screen.findByRole("combobox", { name: "使用连接" }));
  await user.click(screen.getByRole("option", { name: "文章发布" }));
  await user.type(
    screen.getByRole("textbox", { name: "目标文档链接" }),
    "https://my.feishu.cn/wiki/P79mwdka1XSGMMxhNPncqmE0nsh?from=wiki",
  );
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  const documentLink = await screen.findByRole("link", {
    name: "打开这篇文档",
  });
  const permissionLink = screen.getByRole("link", { name: "开通权限" });
  expect(documentLink).toHaveAttribute(
    "href",
    "https://my.feishu.cn/wiki/P79mwdka1XSGMMxhNPncqmE0nsh",
  );
  expect(permissionLink).toHaveAttribute(
    "href",
    "https://open.feishu.cn/app/cli_test/auth?q=wiki:node:read&op_from=openapi&token_type=tenant",
  );
  expect(screen.getByRole("link", { name: "开启机器人" })).toHaveAttribute(
    "href",
    "https://open.feishu.cn/app/cli_test/bot",
  );
  expect(documentLink).toHaveAttribute("target", "_blank");
  expect(permissionLink).toHaveAttribute("rel", "noreferrer");
});
test("wiki guidance appears from the 131006 message before the error code is available", async () => {
  const user = userEvent.setup();
  vi.mocked(sync.getArticleSync).mockResolvedValue({
    binding: null,
    tasks: [],
  });
  vi.mocked(connections.checkExternalTarget).mockRejectedValue(
    new Error(
      "无法读取该知识库节点（错误码 131006）。请确认链接有效，为应用开通知识库节点读取权限",
    ),
  );
  show(<ArticleSyncPanel note={note} close={vi.fn()} />);
  await user.click(await screen.findByRole("combobox", { name: "使用连接" }));
  await user.click(screen.getByRole("option", { name: "文章发布" }));
  await user.type(
    screen.getByRole("textbox", { name: "目标文档链接" }),
    "https://evil.test/wiki/not-feishu",
  );
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  expect(await screen.findByText("应用还不能读取这篇知识库文档")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "打开这篇文档" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "开通权限" })).toHaveAttribute(
    "href",
    "https://open.feishu.cn/app/cli_test/auth?q=wiki:node:read&op_from=openapi&token_type=tenant",
  );
});
