import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationView } from "@features/agent-workbench/ConversationView";
import { HistorySourcePane } from "@features/agent-workbench/HistorySourcePane";
import { FileReader } from "@features/agent-workbench/FileReader";
import {
  fileLanguage,
  highlightLines,
} from "@features/agent-workbench/codeHighlight";
import {
  fileReference,
  commandFiles,
} from "@features/agent-workbench/fileReferences";
import { ToolCodeBlock } from "@features/agent-workbench/ToolCodeBlock";
import { toolCode } from "@features/agent-workbench/toolCode";
import { getHistory, getHistorySource } from "@features/agent-workbench/api";
import {
  workbenchEntries,
  workbenchSessions,
} from "../e2e/fixtures/agent-workbench";

vi.mock("@features/agent-workbench/api", async (original) => ({
  ...(await original<typeof import("@features/agent-workbench/api")>()),
  getHistory: vi.fn(),
  getHistorySource: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it("highlights complete documents while preserving multiline comments, blank lines and source text", () => {
  const text =
    '/* first\n * second\n */\nconst label = "<script>alert(1)</script>";\n\n';
  const lines = highlightLines(text, fileLanguage("src/Example.TSX"));
  expect(
    lines.map((line) => line.map((token) => token.text).join("")).join("\n"),
  ).toBe(text);
  expect(lines[1][0].className).toContain("hljs-comment");
  expect(
    lines[3].some((token) => token.className.includes("hljs-keyword")),
  ).toBe(true);
  expect(fileLanguage("script.py")).toBe("python");
  expect(fileLanguage("data.json")).toBe("json");
  expect(fileLanguage("script.sh")).toBe("bash");
  expect(fileLanguage("Makefile")).toBe("makefile");
  expect(fileLanguage("unknown.custom")).toBeUndefined();
  expect(
    highlightLines("<tag>\nplain", undefined)
      .flat()
      .every((token) => !token.className),
  ).toBe(true);
  const large = "x".repeat(128 * 1024 + 1);
  expect(highlightLines(large, "javascript")).toEqual([
    [{ text: large, className: "" }],
  ]);
});

it("keeps file line targeting and diff highlighting without interpreting source as HTML", () => {
  const text =
    'export const value = "<img src=x onerror=alert(1)>";\n/* comment\ncontinued */';
  const { container } = render(
    <FileReader
      data={{ path: "sample.ts", text, line: 2, diff: "-old\n+new" }}
      pending={false}
      close={() => {}}
    />,
  );
  const source = screen.getByLabelText("当前文件内容");
  expect(source).toHaveAttribute("data-language", "typescript");
  expect(source.querySelector(".hljs-keyword")).toHaveTextContent("export");
  expect(source.querySelector(".is-target .hljs-comment")).toHaveTextContent(
    "/* comment",
  );
  expect(container.querySelector("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "显示更改" }));
  expect(
    screen.getByLabelText("审批差异").querySelector(".is-added .hljs-addition"),
  ).toHaveTextContent("+new");
  fireEvent.click(screen.getByRole("button", { name: "当前文件" }));
  expect(
    screen.getByLabelText("当前文件内容").querySelectorAll(".aw-source-line"),
  ).toHaveLength(3);
});

it("gates reading while locked and hides cached file content on relock", async () => {
  vi.mocked(getHistorySource).mockResolvedValue({
    path: "src/app.ts",
    text: "private project text",
    line: null,
    diff: null,
  });
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const unlock = vi.fn();
  const content = (allowed: boolean) => (
    <QueryClientProvider client={query}>
      <HistorySourcePane
        owner="fixture"
        sessionId="session"
        target={{ path: "src/app.ts" }}
        close={() => {}}
        access={{ allowed, unlock }}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(content(false));
  expect(getHistorySource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "验证并阅读" }));
  expect(unlock).toHaveBeenCalledOnce();
  rerender(content(true));
  const source = await screen.findByLabelText("当前文件内容");
  expect(source).toHaveTextContent("private project text");
  expect(source).toBeVisible();
  rerender(content(false));
  expect(screen.queryByLabelText("当前文件内容")).toBeNull();
});

it("decodes shell arguments while preserving wrapper scripts and filters unsafe links", () => {
  expect(toolCode('{"cmd":"printf hello"}', "exec_command")).toEqual({
    text: "printf hello",
    language: "bash",
    label: "Shell",
  });
  expect(
    toolCode("const r = await tools.exec_command({cmd: 'ls'})", "exec")
      .language,
  ).toBe("javascript");
  expect(fileReference("/project/my%20file.ts:12:3")).toEqual({
    path: "/project/my file.ts",
    line: 12,
  });
  expect(fileReference("src/app.ts#L9")).toEqual({
    path: "src/app.ts",
    line: 9,
  });
  for (const path of [
    "javascript:alert(1)",
    "https://example.com/a.ts",
    "../private.ts",
    "file:///etc/passwd",
    "bad%00.ts",
    "//example.com/a.ts",
  ]) {
    expect(fileReference(path)).toBeUndefined();
  }
  expect(
    commandFiles("rg value src/app.ts; cat 'README.md'").map((x) => x.path),
  ).toEqual(["src/app.ts", "README.md"]);
  expect(
    commandFiles("results.forEach(result => text(result.value));"),
  ).toEqual([]);
});

it("copies the original command and toggles wrapping without changing its contents", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  render(
    <ToolCodeBlock text={'printf "hello"\n'} label="Shell" language="bash" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Shell自动换行" }));
  expect(screen.getByLabelText("Shell")).toHaveClass("is-wrapped");
  fireEvent.click(screen.getByRole("button", { name: "复制Shell" }));
  await screen.findByText("已复制");
  expect(copy).toHaveBeenCalledWith('printf "hello"\n');
});

it("opens markdown file links in the reader, cancels old reads, and restores focus", async () => {
  const entry = {
    ...workbenchEntries()[1],
    text: "查看 [源码](src/app.ts:2) 与 [另一个文件](src/next.ts)",
  };
  vi.mocked(getHistory).mockResolvedValue({
    items: [entry],
    change_cursor: 1,
    next_cursor: null,
  });
  vi.mocked(getHistorySource).mockImplementation(async (_id, target) => ({
    path: target.path,
    line: target.line,
    text: "one\ntwo\n",
    diff: null,
  }));
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <ConversationView
        item={workbenchSessions[0]}
        owner="fixture"
        paused={false}
      />
    </QueryClientProvider>,
  );
  const link = await screen.findByRole("button", { name: "源码" });
  link.focus();
  fireEvent.click(link);
  expect(await screen.findByText("two")).toBeVisible();
  expect(getHistorySource).toHaveBeenCalledWith(
    "fixture-0",
    { path: "src/app.ts", line: 2 },
    expect.any(AbortSignal),
  );
  expect(screen.getByText("two").closest(".aw-source-line")).toHaveClass(
    "is-target",
  );
  fireEvent.keyDown(screen.getByLabelText("源码预览"), { key: "Escape" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "源码" })).toHaveFocus(),
  );
  expect(screen.queryByLabelText("源码预览")).toBeNull();
  let aborted = false;
  vi.mocked(getHistorySource).mockImplementation(
    (_id, _target, signal) =>
      new Promise(() =>
        signal?.addEventListener("abort", () => {
          aborted = true;
        }),
      ),
  );
  fireEvent.click(screen.getByRole("button", { name: "源码" }));
  await screen.findByText("正在读取源码…");
  fireEvent.click(screen.getByRole("button", { name: "另一个文件" }));
  await waitFor(() => expect(aborted).toBe(true));
});
