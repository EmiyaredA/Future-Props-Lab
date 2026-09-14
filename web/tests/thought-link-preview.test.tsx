import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { LinkPreviewCard } from "@features/thought-workshop/LinkPreviewCard";
import { getLinkPreview } from "@features/thought-workshop/api";
import { thoughtKeys } from "@features/thought-workshop/queryKeys";

vi.mock("@features/thought-workshop/api", () => ({ getLinkPreview: vi.fn() }));
vi.mock("@features/thought-workshop/useLinkPreviewPosition", () => ({
  useLinkPreviewPosition: () => {},
}));
const editors: Editor[] = [];
const clients: QueryClient[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.view.dom.remove();
    editor.destroy();
  });
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.resetAllMocks();
});
const result = (url: string) => ({
  url,
  final_url: url,
  domain: "example.com",
  title: "Evaluate agent performance",
  description: "会话成功评价说明",
  available: true,
});
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
function setup(workspaceId = "workspace-a") {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ link: { HTMLAttributes: { tabindex: "0" } } }),
    ],
    content:
      '<p><a href="https://example.com/docs">[28]</a> <a href="https://other.example/docs">[29]</a> <a href="mailto:a@example.com">邮件</a></p>',
  });
  document.body.append(editor.view.dom);
  editors.push(editor);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = (workspace: string) => (
    <QueryClientProvider client={client}>
      <WorkspacePermissionsProvider
        workspaceId={workspace}
        permissions={["content.read"]}
      >
        <LinkPreviewCard key={workspace} editor={editor} />
      </WorkspacePermissionsProvider>
    </QueryClientProvider>
  );
  const rendered = render(view(workspaceId));
  const links = editor.view.dom.querySelectorAll("a");
  vi.mocked(getLinkPreview).mockImplementation(async (url) => result(url));
  return { editor, client, links, ...rendered, view };
}

it("waits 300ms, stays open when entering the card, and never edits the document", async () => {
  const { editor, links } = setup();
  const before = editor.getJSON();
  const update = vi.fn();
  editor.on("update", update);
  fireEvent.pointerOver(links[0]);
  await tick(298);
  expect(getLinkPreview).not.toHaveBeenCalled();
  await tick(30);
  const card = screen.getByRole("dialog", { name: "链接预览" });
  expect(screen.getByText("Evaluate agent performance")).toBeInTheDocument();
  fireEvent.pointerOut(links[0], { relatedTarget: card });
  fireEvent.pointerEnter(card);
  await tick(200);
  expect(card).toBeInTheDocument();
  fireEvent.pointerLeave(card);
  await tick(151);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(editor.getJSON()).toEqual(before);
  expect(update).not.toHaveBeenCalled();
});

it("supports focus, Tab into the card, Shift+Tab back and Escape without reopening", async () => {
  const { links } = setup();
  act(() => links[0].focus());
  await tick(20);
  fireEvent.keyDown(links[0], { key: "Tab" });
  const action = screen.getByRole("link", { name: "打开原文" });
  expect(action).toHaveFocus();
  fireEvent.keyDown(action, { key: "Tab", shiftKey: true });
  expect(links[0]).toHaveFocus();
  fireEvent.keyDown(links[0], { key: "Tab" });
  fireEvent.keyDown(action, { key: "Escape" });
  await tick(200);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(links[0]).toHaveFocus();
});

it("aborts the previous request when the hovered link changes", async () => {
  const { links } = setup();
  let previous: AbortSignal | undefined;
  vi.mocked(getLinkPreview).mockImplementationOnce((_url, signal) => {
    previous = signal;
    return new Promise(() => {});
  });
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(screen.getByRole("status")).toHaveTextContent("正在读取链接信息");
  fireEvent.pointerOver(links[1]);
  await tick(310);
  expect(previous?.aborted).toBe(true);
  expect(screen.getByRole("link", { name: "打开原文" })).toHaveAttribute(
    "href",
    links[1].href,
  );
});

it("caches successful previews for 10 minutes and isolates workspaces", async () => {
  const { links, rerender, view, client } = setup();
  fireEvent.pointerOver(links[0]);
  await tick(310);
  fireEvent.keyDown(links[0], { key: "Escape" });
  await tick(60_000);
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(getLinkPreview).toHaveBeenCalledTimes(1);
  expect(
    client.getQueryData(thoughtKeys.linkPreview("workspace-a", links[0].href)),
  ).toBeDefined();
  rerender(view("workspace-b"));
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(getLinkPreview).toHaveBeenCalledTimes(2);
  expect(
    client.getQueryData(thoughtKeys.linkPreview("workspace-b", links[0].href)),
  ).toBeDefined();
});

it("shows a usable fallback, caches it for one minute, and ignores mail links", async () => {
  const { links } = setup();
  vi.mocked(getLinkPreview).mockImplementation(async (url) => ({
    ...result(url),
    title: null,
    description: null,
    available: false,
  }));
  fireEvent.pointerOver(links[2]);
  await tick(310);
  expect(getLinkPreview).not.toHaveBeenCalled();
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(screen.getByText("暂时无法获取页面简介")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "打开原文" })).toHaveAttribute(
    "href",
    links[0].href,
  );
  fireEvent.keyDown(links[0], { key: "Escape" });
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(getLinkPreview).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(links[0], { key: "Escape" });
  await tick(60_000);
  fireEvent.pointerOver(links[0]);
  await tick(310);
  expect(getLinkPreview).toHaveBeenCalledTimes(2);
});

it("closes on replacing a document without emitting an update", async () => {
  const { editor, links } = setup();
  fireEvent.pointerOver(links[0]);
  await tick(310);
  act(() =>
    editor.commands.setContent("<p>其他文档</p>", { emitUpdate: false }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
