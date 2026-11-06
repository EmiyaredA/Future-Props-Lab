import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import {
  GALGAME_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  VISUAL_WORKSHOP_MODULE,
} from "@app/applicationRegistry";
import { KnowledgeSidebar } from "@features/thought-workshop/KnowledgeSidebar";
import { KnowledgeSections } from "@features/thought-workshop/KnowledgeSections";
import {
  DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH,
  KNOWLEDGE_SIDEBAR_WIDTH_KEY,
} from "@features/thought-workshop/knowledgeSidebarWidth";

afterEach(() => {
  localStorage.removeItem(KNOWLEDGE_SIDEBAR_WIDTH_KEY);
});

describe("shared workshop sidebar", () => {
  it.each([false, true])(
    "separates global navigation from library navigation (readOnly=%s)",
    async (readOnly) => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      const props = {
        sidebarRef: { current: null },
        drawer: false,
        close: vi.fn(),
        onBack: vi.fn(),
        onNavigate,
        discover: vi.fn(),
        sections: <KnowledgeSections active="private" navigate={vi.fn()} />,
        readOnly,
        query: "",
        search: vi.fn(),
        view: "all",
        browsing: false,
        home: vi.fn(),
        selectView: vi.fn(),
        trash: false,
        selectTrash: vi.fn(),
        children: <p>目录内容</p>,
      };
      const { rerender } = render(
        <KnowledgeSidebar {...props} inside={false} />,
      );
      const sidebar = within(
        screen.getByRole("complementary", { name: "知识库导航" }),
      );
      for (const name of ["我的知识库", "知识社区", "我的收藏", "我的发布"])
        expect(sidebar.getByRole("button", { name })).toBeVisible();
      expect(
        sidebar.getByRole("button", { name: "搜索与最近访问" }),
      ).toBeVisible();
      expect(
        sidebar.queryByLabelText("搜索当前知识库"),
      ).not.toBeInTheDocument();

      rerender(<KnowledgeSidebar {...props} inside />);
      expect(
        sidebar.queryByRole("navigation", { name: "思绪工坊入口" }),
      ).not.toBeInTheDocument();
      for (const name of ["知识社区", "我的收藏", "我的发布", "搜索与最近访问"])
        expect(sidebar.queryByRole("button", { name })).not.toBeInTheDocument();
      expect(sidebar.getByLabelText("搜索当前知识库")).toBeVisible();
      expect(
        sidebar.getByRole("navigation", { name: "当前知识库视图" }),
      ).toBeVisible();
      expect(sidebar.getByText("目录内容")).toBeVisible();
      expect(
        sidebar.queryByRole("button", { name: "文档回收站" }) !== null,
      ).toBe(!readOnly);
      const back = sidebar.getByRole("button", {
        name: "我的知识库",
      });
      expect(back).toHaveClass("workshop-back");
      back.focus();
      await user.keyboard("{Enter}");
      expect(onNavigate).toHaveBeenCalledWith();

      rerender(<KnowledgeSidebar {...props} inside={false} />);
      expect(
        sidebar.getByRole("navigation", { name: "思绪工坊入口" }),
      ).toBeVisible();
      expect(
        sidebar.getByRole("button", { name: "搜索与最近访问" }),
      ).toBeVisible();
    },
  );

  for (const module of [
    GALGAME_WORKSHOP_MODULE,
    VIDEO_EDITOR_MODULE,
    VISUAL_WORKSHOP_MODULE,
  ]) {
    it(`preserves ${module.definition.name} branding, navigation and return action`, async () => {
      const user = userEvent.setup();
      const back = vi.fn(),
        navigate = vi.fn();
      const item = module.shellConfig.navigation[0];
      render(
        <WorkshopShell
          module={module}
          page={item.page}
          navigate={navigate}
          onBack={back}
        >
          <p>项目内容</p>
        </WorkshopShell>,
      );
      expect(screen.getAllByRole("complementary")).toHaveLength(1);
      expect(screen.getByText(module.definition.name)).toBeVisible();
      expect(screen.getByText(module.shellConfig.backSubtitle)).toBeVisible();
      const link = screen.getByRole("button", {
        name: item.label,
      });
      expect(link).toHaveAttribute("aria-current", "page");
      link.focus();
      await user.keyboard("{Enter}");
      expect(navigate).toHaveBeenCalledWith(item.page);
      await user.click(screen.getByRole("button", { name: "返回应用中心" }));
      expect(back).toHaveBeenCalledOnce();
    });
  }

  it("keeps knowledge filters directly accessible alongside the directory", async () => {
    const user = userEvent.setup();
    const selectView = vi.fn();
    const onNavigate = vi.fn();
    render(
      <KnowledgeSidebar
        sidebarRef={{ current: null }}
        drawer={false}
        close={vi.fn()}
        onBack={vi.fn()}
        onNavigate={onNavigate}
        inside
        query=""
        search={vi.fn()}
        view="recent"
        browsing
        home={vi.fn()}
        selectView={selectView}
        trash={false}
        selectTrash={vi.fn()}
      >
        <p>目录内容</p>
      </KnowledgeSidebar>,
    );
    const sidebar = within(
      screen.getByRole("complementary", { name: "知识库导航" }),
    );
    expect(
      sidebar.queryByRole("button", { name: "返回应用中心" }),
    ).not.toBeInTheDocument();
    expect(
      sidebar.queryByRole("combobox", { name: "切换知识库" }),
    ).not.toBeInTheDocument();
    expect(sidebar.getByRole("button", { name: "我的知识库" })).toBeVisible();
    expect(sidebar.getByText("浏览全部知识库")).toBeVisible();
    expect(sidebar.getByText("目录内容")).toBeVisible();
    for (const name of [
      "首页",
      "全部文档",
      "最近编辑",
      "收藏文档",
      "文档回收站",
    ])
      expect(sidebar.getByRole("button", { name })).toBeVisible();
    expect(sidebar.getByRole("button", { name: "最近编辑" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    sidebar.getByRole("button", { name: "收藏文档" }).focus();
    await user.keyboard("{Enter}");
    expect(selectView).toHaveBeenCalledWith("favorites");
    await user.click(sidebar.getByRole("button", { name: "我的知识库" }));
    expect(onNavigate).toHaveBeenCalledWith();
  });

  it("resizes the knowledge sidebar and remembers the width", async () => {
    const { container } = render(
      <KnowledgeSidebar
        sidebarRef={{ current: null }}
        drawer={false}
        close={vi.fn()}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
        inside
        query=""
        search={vi.fn()}
        view="all"
        browsing
        home={vi.fn()}
        selectView={vi.fn()}
        trash={false}
        selectTrash={vi.fn()}
      >
        <p>目录内容</p>
      </KnowledgeSidebar>,
    );
    const track = container.querySelector<HTMLElement>(
      ".knowledge-sidebar-track",
    )!;
    expect(track.style.getPropertyValue("--knowledge-sidebar-width")).toBe(
      `${DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH}px`,
    );
    const divider = screen.getByRole("separator", {
      name: "调整知识库导航宽度",
    });
    fireEvent(
      divider,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 236,
      }),
    );
    fireEvent(window, new MouseEvent("pointermove", { clientX: 300 }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    fireEvent(window, new MouseEvent("pointerup", { clientX: 300 }));
    expect(track.style.getPropertyValue("--knowledge-sidebar-width")).toBe(
      "300px",
    );
    expect(localStorage.getItem(KNOWLEDGE_SIDEBAR_WIDTH_KEY)).toBe("300");

    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(track.style.getPropertyValue("--knowledge-sidebar-width")).toBe(
      "290px",
    );

    fireEvent.doubleClick(divider);
    expect(track.style.getPropertyValue("--knowledge-sidebar-width")).toBe(
      `${DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH}px`,
    );
    expect(localStorage.getItem(KNOWLEDGE_SIDEBAR_WIDTH_KEY)).toBe(
      String(DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH),
    );
  });
});
