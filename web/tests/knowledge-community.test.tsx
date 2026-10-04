import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { ApiError } from "@platform/api/client";
import {
  DocumentAccessProvider,
  type DocumentAccess,
} from "@features/thought-workshop/DocumentAccess";
import { useNoteDraft } from "@features/thought-workshop/useNoteDraft";
import { PublicationDialog } from "@features/thought-workshop/community/PublicationDialog";
import { PermissionsDialog } from "@features/thought-workshop/community/PermissionsDialog";
import * as community from "@features/thought-workshop/community/api";
import * as storage from "@features/thought-workshop/drafts/storage";
import type { Note } from "@features/thought-workshop/api";
vi.mock("@features/thought-workshop/drafts/storage", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/drafts/storage")
  >()),
  listLocalDrafts: vi.fn().mockResolvedValue([]),
  putLocalDraft: vi.fn().mockResolvedValue("draft"),
  removeLocalDraft: vi.fn().mockResolvedValue(undefined),
  draftTabId: () => "tab",
}));
vi.mock("@features/thought-workshop/community/api", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/community/api")
  >()),
  getPublicationConfig: vi.fn(),
  publishLibrary: vi.fn(),
  getArticlePermissions: vi.fn(),
  setArticlePermissions: vi.fn(),
}));
const note: Note = {
  id: "note",
  title: "当前正文",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  tags: [],
  schema_version: 3,
  pinned: false,
  favorite: false,
  revision: 2,
  knowledge_base_id: "kb",
  parent_id: null,
  position: 0,
  is_home: false,
  deleted_at: null,
  excerpt: "",
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
};
const source = {
  id: "kb",
  title: "创作手记",
  description: "简介",
  revision: 1,
  cover_asset_id: null,
  home_note_id: "home",
  document_count: 1,
  deleted_at: null,
  created_at: note.created_at,
  updated_at: note.updated_at,
};
function owner(children: ReactNode, user = "user-a") {
  return (
    <WorkspacePermissionsProvider
      userId={user}
      workspaceId="different-workspace"
      permissions={[]}
    >
      {children}
    </WorkspacePermissionsProvider>
  );
}
function query(children: ReactNode) {
  return owner(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}
function access(
  save: DocumentAccess["save"],
  namespace = "community/user-a/pub",
): DocumentAccess {
  return {
    namespace,
    community: true,
    canViewHistory: false,
    save,
    assetUrl: (id) => `/community/${id}`,
    uploadImage: vi.fn(),
    uploadAttachment: vi.fn(),
    resolveReferences: vi.fn(),
    searchNotes: vi.fn(),
    backlinks: vi.fn(),
    referenceHref: () => "/community/doc",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.listLocalDrafts).mockResolvedValue([]);
});
describe("社区发布与恢复边界", () => {
  it("defaults every new article to unpublished and submits only explicitly selected content", async () => {
    const user = userEvent.setup(),
      saved = vi.fn();
    vi.mocked(community.getPublicationConfig).mockResolvedValue({
      can_set_official: false,
      publication: null,
      articles: [],
    });
    vi.mocked(community.publishLibrary).mockResolvedValue({
      can_set_official: false,
      publication: { id: "pub" } as community.Publication,
      articles: [],
    });
    render(
      query(
        <PublicationDialog
          directory={{ knowledge_base: source, documents: [note] }}
          close={() => {}}
          saved={saved}
        />,
      ),
    );
    await waitFor(() =>
      expect(community.getPublicationConfig).toHaveBeenCalledWith("kb"),
    );
    expect(screen.getByLabelText("只读发布")).toBeChecked();
    expect(screen.queryByLabelText("官方发布")).toBeNull();
    expect(screen.getByLabelText("发布 当前正文")).not.toBeChecked();
    expect(screen.getByLabelText("发布 知识库首页")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "发布选定文章" })).toBeDisabled();
    await user.click(screen.getByLabelText("发布 当前正文"));
    await user.click(screen.getByRole("button", { name: "发布选定文章" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("pub"));
    expect(community.publishLibrary).toHaveBeenCalledWith(
      "kb",
      expect.objectContaining({
        expected_revision: 0,
        read_only: true,
        is_official: false,
        articles: [
          expect.objectContaining({
            note_id: "note",
            expected_revision: 0,
            active: true,
            visibility: "public",
          }),
        ],
      }),
    );
  });
  it("only administrator configuration exposes official certification and role editing", async () => {
    const user = userEvent.setup();
    vi.mocked(community.publishLibrary).mockResolvedValue({
      can_set_official: true,
      publication: { id: "pub" } as community.Publication,
      articles: [],
    });
    vi.mocked(community.getPublicationConfig).mockResolvedValue({
      can_set_official: true,
      publication: null,
      articles: [],
    });
    render(
      query(
        <PublicationDialog
          directory={{ knowledge_base: source, documents: [note] }}
          close={() => {}}
          saved={() => {}}
        />,
      ),
    );
    await user.click(await screen.findByLabelText("官方发布"));
    expect(screen.getByLabelText("只读发布")).toBeChecked();
    expect(screen.getByLabelText("超级管理员可编辑")).toBeChecked();
    expect(
      screen.getByLabelText("管理员可编辑", { exact: true }),
    ).toBeChecked();
    expect(screen.getByLabelText("普通用户可编辑")).not.toBeChecked();
    await user.click(screen.getByLabelText("发布 当前正文"));
    await user.click(screen.getByRole("button", { name: "发布选定文章" }));
    await waitFor(() =>
      expect(community.publishLibrary).toHaveBeenCalledWith(
        "kb",
        expect.objectContaining({
          is_official: true,
          read_only: true,
          editable_platform_roles: ["super_admin", "admin"],
        }),
      ),
    );
  });
  it("bulk permission changes preserve the explicit publication selection", async () => {
    const user = userEvent.setup();
    vi.mocked(community.getPublicationConfig).mockResolvedValue({
      can_set_official: false,
      publication: null,
      articles: [],
    });
    vi.mocked(community.publishLibrary).mockResolvedValue({
      can_set_official: false,
      publication: { id: "pub" } as community.Publication,
      articles: [],
    });
    render(
      query(
        <PublicationDialog
          directory={{ knowledge_base: source, documents: [note] }}
          close={() => {}}
          saved={() => {}}
        />,
      ),
    );
    await waitFor(() =>
      expect(community.getPublicationConfig).toHaveBeenCalled(),
    );
    await user.click(screen.getByLabelText("发布 当前正文"));
    await user.click(screen.getByLabelText("批量设置 知识库首页"));
    await user.click(screen.getAllByRole("button", { name: /^权限$/ }).at(-1)!);
    await user.click(
      screen.getByRole("button", { name: "将此权限应用到选中的 1 篇" }),
    );
    expect(screen.getByLabelText("发布 知识库首页")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "发布选定文章" }));
    await waitFor(() => expect(community.publishLibrary).toHaveBeenCalled());
    expect(
      vi.mocked(community.publishLibrary).mock.calls[0][1].articles,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ note_id: "home", active: false }),
        expect.objectContaining({ note_id: "note", active: true }),
      ]),
    );
  });
  it("keeps failed permission edits until an explicit reload, with each article's own revision", async () => {
    const user = userEvent.setup();
    vi.mocked(community.getArticlePermissions).mockResolvedValue([
      {
        note_id: "a",
        title: "文章 A",
        revision: 3,
        visibility: "members",
        active: true,
        members: [],
      },
      {
        note_id: "b",
        title: "文章 B",
        revision: 8,
        visibility: "public",
        active: true,
        members: [],
      },
    ]);
    vi.mocked(community.setArticlePermissions).mockRejectedValue(
      new Error("版本冲突"),
    );
    render(
      query(
        <PermissionsDialog
          publication="pub"
          notes={["a", "b"]}
          close={() => {}}
          saved={() => {}}
        />,
      ),
    );
    await screen.findByRole("combobox", { name: "文章访问范围" });
    await waitFor(() =>
      expect(screen.getByRole("alertdialog")).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await user.type(screen.getByLabelText("成员账号"), "reader");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));
    await screen.findByText("版本冲突");
    expect(screen.getByText("reader", { exact: true })).toBeVisible();
    expect(community.getArticlePermissions).toHaveBeenCalledTimes(1);
    expect(community.setArticlePermissions).toHaveBeenCalledWith("pub", [
      expect.objectContaining({
        note_id: "a",
        expected_revision: 3,
        members: [{ username: "reader", role: "read" }],
      }),
      expect.objectContaining({ note_id: "b", expected_revision: 8 }),
    ]);
    await user.click(screen.getByRole("button", { name: "重新载入权限" }));
    await waitFor(() =>
      expect(
        screen.queryByText("reader", { exact: true }),
      ).not.toBeInTheDocument(),
    );
  });
  it("saves through the publication adapter and retains account/resource-scoped drafts after revocation", async () => {
    const save = vi
      .fn<DocumentAccess["save"]>()
      .mockRejectedValue(new ApiError("文章访问权限已撤销", {}, 404));
    const wrapper = ({ children }: { children: ReactNode }) =>
      owner(
        <DocumentAccessProvider value={access(save)}>
          {children}
        </DocumentAccessProvider>,
      );
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.localReady).toBe(true));
    expect(storage.listLocalDrafts).toHaveBeenCalledWith(
      { userId: "user-a", workspaceId: "community/user-a/pub" },
      "note",
    );
    act(() => result.current.change({ title: "保留本机修改" }));
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow("已撤销");
    });
    expect(result.current.draft.title).toBe("保留本机修改");
    expect(result.current.state).toBe("error");
    act(() => result.current.change({ title: "继续保留修改" }));
    await expect(result.current.flush()).rejects.toThrow("保存已停止");
    expect(save).toHaveBeenCalledTimes(1);
    expect(storage.removeLocalDraft).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(storage.putLocalDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          userId: "user-a",
          workspaceId: "community/user-a/pub",
          body: expect.objectContaining({ title: "继续保留修改" }),
        }),
      ),
    );
    unmount();
  });
});
