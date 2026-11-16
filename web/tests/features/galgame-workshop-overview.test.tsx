import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { GalgameWorkshopOverviewPage } from "@features/galgame-workshop/overview";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
} from "@features/galgame-workshop/api";

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return {
    ...actual,
    getGalgameWorkshopProject: vi.fn(),
    getGalgameStoryDocument: vi.fn(),
    getGalgameStoryReport: vi.fn(),
  };
});

const project = {
  is_official: false,
  id: "project-1",
  title: "空白工程",
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-05T08:00:00Z",
  updated_at: "2026-08-05T08:00:00Z",
};

function renderPage(onProjects = vi.fn(), onOpenEditor = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GalgameWorkshopOverviewPage
        projectId="project-1"
        onProjects={onProjects}
        onOpenEditor={onOpenEditor}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getGalgameWorkshopProject).mockResolvedValue(project);
  vi.mocked(getGalgameStoryDocument).mockResolvedValue({
    project_id: "project-1",
    document: {
      schemaVersion: "1.0",
      synopsis: "",
      chapters: [
        {
          id: "chapter-1",
          title: "第一章",
          order: 1,
          entryFragmentId: "main",
          fragments: [{ id: "main", title: "main", blocks: [] }],
        },
      ],
      characters: [],
      scenes: [],
      variables: [],
      assets: [],
    },
    revision: 0,
    updated_at: "2026-08-05T08:00:00Z",
  });
  vi.mocked(getGalgameStoryReport).mockResolvedValue({
    project_id: "project-1",
    story_revision: 0,
    ready: true,
    errors: [],
    warnings: [],
    chapters: [
      {
        chapter_id: "chapter-1",
        reachable_fragment_ids: ["main"],
        unreachable_fragment_ids: [],
        ending_ids: ["ending-1"],
        cycles: [],
      },
    ],
  });
});

test("shows story counts and opens the real editor", async () => {
  const user = userEvent.setup();
  const onProjects = vi.fn();
  const onOpenEditor = vi.fn();
  renderPage(onProjects, onOpenEditor);
  expect(
    await screen.findByRole("heading", { name: "空白工程" }),
  ).toBeInTheDocument();
  const stats = screen.getByLabelText("故事摘要");
  expect(stats).toHaveTextContent("1");
  expect(stats).toHaveTextContent("章节");
  expect(stats).toHaveTextContent("角色");
  expect(stats).toHaveTextContent("场景");
  await user.click(screen.getByRole("button", { name: /剧本编辑/ }));
  expect(onOpenEditor).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /返回工程列表/ }));
  expect(onProjects).toHaveBeenCalled();
});

test("shows route readiness without manual project status", async () => {
  renderPage();
  expect(await screen.findByText("线路就绪")).toBeInTheDocument();
  expect(screen.queryByText("草稿")).not.toBeInTheDocument();
  expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "标记完成" }),
  ).not.toBeInTheDocument();
});

test("shows route errors and keeps the editor available", async () => {
  vi.mocked(getGalgameStoryReport).mockResolvedValueOnce({
    project_id: "project-1",
    story_revision: 0,
    ready: false,
    errors: [
      {
        code: "open_fragment",
        message: "线路没有结局",
        path: "/chapters/0/fragments/0",
      },
    ],
    warnings: [],
    chapters: [],
  });
  renderPage();
  expect(await screen.findByText("仍需完善线路")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "进入编辑器" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "标记完成" }),
  ).not.toBeInTheDocument();
});
