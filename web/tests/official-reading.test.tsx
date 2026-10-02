import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialArticle } from "@features/thought-workshop/official/OfficialArticle";
import { OfficialLibraryHome } from "@features/thought-workshop/official/ReadingNavigation";
import { findOfficialLibrary } from "@features/thought-workshop/official/catalog";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("official reading blocks and navigation", () => {
  it("renders only the three controlled alert types and never source HTML", () => {
    const { container } = render(
      <OfficialArticle
        onOpen={vi.fn()}
        markdown={
          '# 说明\n\n> [!NOTE]\n> 保存后刷新查看结果。\n\n> [!TIP]\n> 先创建一个小项目。\n\n> [!WARNING]\n> 冲突时保留本地副本。\n\n> [!DANGER]\n> 普通引用\n\n<script>alert(1)</script>\n\n<div onclick="alert(1)">执行代码</div>'
        }
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "说明" }),
    ).toHaveTextContent("保存后刷新查看结果。");
    expect(
      screen.getByRole("complementary", { name: "提示" }),
    ).toHaveTextContent("先创建一个小项目。");
    expect(
      screen.getByRole("complementary", { name: "注意" }),
    ).toHaveTextContent("冲突时保留本地副本。");
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(container.querySelector("blockquote")).toHaveTextContent(
      "[!DANGER]",
    );
    expect(container.querySelector("script, [onclick]")).toBeNull();
  });

  it("highlights code locally and copies its exact plain source with feedback", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    const { container } = render(
      <OfficialArticle
        onOpen={vi.fn()}
        markdown={'# 示例\n\n```python\nprint("你好")\nvalue = 3\n```'}
      />,
    );
    expect(screen.getByText("python")).toBeVisible();
    expect(container.querySelector(".hljs-string")).toHaveTextContent('"你好"');
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith('print("你好")\nvalue = 3'),
    );
    expect(await screen.findByText("复制成功")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制代码" })).toHaveTextContent(
      "已复制",
    );
  });

  it("reports clipboard failure without removing the selectable source", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(
      <OfficialArticle
        onOpen={vi.fn()}
        markdown={"# 示例\n\n```unknown-language\n可手动复制的原文\n```"}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    expect(
      await screen.findByText("复制失败，请手动选择内容复制"),
    ).toBeVisible();
    expect(screen.getByText("可手动复制的原文")).toBeVisible();
  });

  it("copies a stable heading URL and updates outline location as the reading root scrolls", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    window.history.replaceState(
      null,
      "",
      "/apps/thought-workshop/official-knowledge-bases/general/documents/start",
    );
    const { container } = render(
      <main className="knowledge-main">
        <OfficialArticle
          onOpen={vi.fn()}
          markdown={"# 入门\n\n## 配置\n\n正文\n\n## 检查结果\n\n成功"}
        />
      </main>,
    );
    fireEvent.click(screen.getByText("文档大纲"));
    const configuration = screen.getByRole("heading", { name: "配置" });
    const result = screen.getByRole("heading", { name: "检查结果" });
    vi.spyOn(configuration, "getBoundingClientRect").mockReturnValue({
      top: 0,
    } as DOMRect);
    vi.spyOn(result, "getBoundingClientRect").mockReturnValue({
      top: 500,
    } as DOMRect);
    fireEvent.scroll(container.querySelector("main")!);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "配置" })).toHaveAttribute(
        "aria-current",
        "location",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制章节链接：配置" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        `${window.location.href}#${configuration.id}`,
      ),
    );
    vi.spyOn(result, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);
    fireEvent.scroll(container.querySelector("main")!);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "检查结果" })).toHaveAttribute(
        "aria-current",
        "location",
      ),
    );
  });

  it("shows introductory summaries and navigates to adjacent and related articles", () => {
    const library = findOfficialLibrary("general")!;
    const onOpen = vi.fn();
    const { unmount } = render(
      <OfficialLibraryHome library={library} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /从这里开始/ }));
    expect(onOpen).toHaveBeenLastCalledWith("general", "start");
    expect(
      screen.getAllByText(library.documents[0].summary).length,
    ).toBeGreaterThan(0);
    unmount();
    render(
      <OfficialArticle
        libraryId="general"
        documentId="accounts"
        markdown="# Workspace"
        onOpen={onOpen}
      />,
    );
    const adjacent = screen.getByRole("navigation", { name: "前后篇导航" });
    fireEvent.click(within(adjacent).getByRole("button", { name: /上一篇/ }));
    expect(onOpen).toHaveBeenLastCalledWith("general", "applications");
    fireEvent.click(within(adjacent).getByRole("button", { name: /下一篇/ }));
    expect(onOpen).toHaveBeenLastCalledWith("general", "files");
    const related = library.documents[1].related[0];
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "相关阅读" })).getAllByRole(
        "button",
      )[0],
    );
    expect(onOpen).toHaveBeenLastCalledWith(
      related.libraryId,
      related.documentId,
    );
  });

  it("preserves table scroll and focus when an outer navigation callback changes", () => {
    const markdown = "# 表格\n\n| 列一 | 列二 |\n|---|---|\n| 一 | 二 |";
    const { rerender } = render(
      <OfficialArticle markdown={markdown} onOpen={vi.fn()} />,
    );
    const table = screen.getByRole("region", { name: "文档表格" });
    table.scrollLeft = 140;
    table.focus();
    rerender(<OfficialArticle markdown={markdown} onOpen={vi.fn()} />);
    expect(screen.getByRole("region", { name: "文档表格" })).toBe(table);
    expect(table.scrollLeft).toBe(140);
    expect(table).toHaveFocus();
  });

  it("focuses the new article title and honors an explicit chapter link", async () => {
    const { rerender } = render(
      <OfficialArticle key="first" markdown="# 第一篇" onOpen={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "第一篇" })).toHaveFocus(),
    );
    rerender(
      <OfficialArticle
        key="next"
        markdown={"# 下一篇\n\n## 保存"}
        onOpen={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "下一篇" })).toHaveFocus(),
    );
    const chapter = screen.getByRole("heading", { name: "保存" });
    window.history.replaceState(null, "", `/#${chapter.id}`);
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(chapter).toHaveFocus());
  });
});
