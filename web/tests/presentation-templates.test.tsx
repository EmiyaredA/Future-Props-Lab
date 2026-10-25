import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import cases from "../../tests/fixtures/presentation_template_cases.json";
import {
  resolveSlide,
  chapterEntries,
  tocOverflow,
  defaultDefinition,
  templatePreview,
} from "@features/presentation-workshop/master/model";
import { SlideSurface } from "@features/presentation-workshop/SlideSurface";
import { usePresentationDraft } from "@features/presentation-workshop/usePresentationDraft";
import type { Deck, Project } from "@features/presentation-workshop/types";
import { saveProject } from "@features/presentation-workshop/api";
vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
}));

describe("共享模板解析契约", () => {
  for (const [i, fixture] of cases.entries())
    it(`case ${i + 1}: 页面、目录和页码`, () => {
      const deck = fixture.document as unknown as Deck;
      const copy = JSON.stringify(deck);
      const actual = deck.slides.map((s, index) =>
        resolveSlide(deck, s, index)
          .elements.filter((e) => e.id.startsWith("master-"))
          .map((e) =>
            e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(""),
          ),
      );
      expect(actual).toEqual(fixture.texts);
      const styles = deck.slides.map((s, index) =>
        resolveSlide(deck, s, index)
          .elements.filter(
            (e) => e.id.startsWith("master-") && e.kind === "text",
          )
          .map((e) => ({
            id: e.id,
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
            font: e.paragraphs[0].runs[0].font,
            size: e.paragraphs[0].runs[0].size,
            color: e.paragraphs[0].runs[0].color,
          })),
      );
      expect(styles).toEqual(fixture.styles);
      expect(JSON.stringify(deck)).toBe(copy);
      expect(deck.slides.some((s) => tocOverflow(deck, s))).toBe(
        (fixture.issues as string[]).includes("toc_overflow"),
      );
    });
  it("章节顺序由首次出现决定，改名不改变关联，目录续页解除溢出", () => {
    const deck = structuredClone(cases[0].document) as unknown as Deck;
    deck.chapters![0].title = "改名章节";
    deck.slides.reverse();
    expect(chapterEntries(deck).map((c) => c.title)).toEqual([
      "第二章",
      "改名章节",
    ]);
    deck.template!.snapshot.layouts!.toc!.toc_capacity = 1;
    deck.slides[0].page_type = "toc";
    deck.slides[0].toc_offset = 0;
    deck.slides[1].page_type = "toc";
    deck.slides[1].toc_offset = 1;
    expect(tocOverflow(deck, deck.slides[0])).toBe(false);
  });
  it("画布使用独立模板层，双击派发内容编辑事件", () => {
    const deck = templatePreview(defaultDefinition());
    const { container } = render(
      <SlideSurface slide={deck.slides[0]} size={deck} />,
    );
    const handler = vi.fn();
    container.addEventListener("presentation-template-edit", handler);
    const title = container.querySelector('[data-template-role="title"]')!;
    fireEvent.doubleClick(title);
    expect(handler).toHaveBeenCalledOnce();
    expect(deck.slides[0].elements).toHaveLength(0);
    expect(screen.getByText("让每一页，保持一致")).toBeVisible();
  });
  it("模板应用进入一次历史操作，撤销后使用新 revision 保存", async () => {
    const document = templatePreview(defaultDefinition());
    const initial: Project = {
      id: "doc",
      title: "模板稿",
      revision: 1,
      document,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    const { result } = renderHook(() => usePresentationDraft(initial, vi.fn()));
    const changed = structuredClone(initial);
    changed.revision = 2;
    changed.document.template!.name = "更新模板";
    act(() => result.current.acceptExternal(changed));
    expect(result.current.state).toBe("saved");
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draft.document.template!.name).toBe(
      initial.document.template!.name,
    );
    vi.mocked(saveProject).mockImplementation(async (_id, body, revision) => ({
      ...initial,
      ...body,
      revision: revision + 1,
    }));
    await act(async () => {
      await result.current.flush();
    });
    expect(vi.mocked(saveProject).mock.lastCall?.[2]).toBe(2);
  });
});
