import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import {
  GALGAME_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  VISUAL_WORKSHOP_MODULE,
} from "@app/applicationRegistry";
import { KnowledgeSidebar } from "@features/thought-workshop/KnowledgeSidebar";

describe("shared workshop sidebar", () => {
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
    render(
      <KnowledgeSidebar
        sidebarRef={{ current: null }}
        drawer={false}
        close={vi.fn()}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
        projects={[]}
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
    expect(sidebar.getByText("浏览全部应用")).toBeVisible();
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
  });
});
