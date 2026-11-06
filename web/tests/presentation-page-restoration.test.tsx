import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PresentationEditor } from "@features/presentation-workshop/PresentationEditor";
import { newDeck, newSlide } from "@features/presentation-workshop/templates";
import type { Project } from "@features/presentation-workshop/types";

vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
  imageBlob: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: null, error: null }),
}));
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function project(id = "project"): Project {
  const document = newDeck();
  document.slides.push(newSlide("blank"), newSlide("blank"));
  return {
    id,
    title: "测试",
    document,
    revision: 0,
    created_at: "2026-11-06",
    updated_at: "2026-11-06",
  };
}
function mount(initial: Project) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PresentationEditor
        initial={initial}
        readOnly={false}
        onOpen={vi.fn()}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
const current = (page: number) =>
  expect(
    screen.getByRole("button", { name: `幻灯片 ${page}` }),
  ).toHaveAttribute("aria-current", "true");

it("刷新后按幻灯片身份恢复，重排与不同文稿互不干扰", () => {
  const deck = project();
  const view = mount(deck);
  fireEvent.click(screen.getByRole("button", { name: "幻灯片 3" }));
  view.unmount();
  const reordered = {
    ...deck,
    document: {
      ...deck.document,
      slides: [
        deck.document.slides[2],
        deck.document.slides[0],
        deck.document.slides[1],
      ],
    },
  };
  const restored = mount(reordered);
  current(1);
  restored.unmount();
  const other = mount(project("other"));
  current(1);
  other.unmount();
  mount(deck);
  current(3);
});

it("记录的页面不存在或浏览器存储不可用时回到第一页", () => {
  const deck = project();
  sessionStorage.setItem("presentation-slide:project", "deleted");
  const view = mount(deck);
  current(1);
  view.unmount();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount(deck);
  current(1);
});
