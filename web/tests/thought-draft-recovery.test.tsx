import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { useNoteDraft } from "@features/thought-workshop/useNoteDraft";
import * as api from "@features/thought-workshop/api";
import * as storage from "@features/thought-workshop/drafts/storage";
import { ApiError } from "@platform/api/client";

vi.mock("@features/thought-workshop/drafts/storage", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/drafts/storage")
  >()),
  listLocalDrafts: vi.fn().mockResolvedValue([]),
  putLocalDraft: vi.fn().mockResolvedValue(undefined),
  removeLocalDraft: vi.fn().mockResolvedValue(undefined),
  draftTabId: () => "current-tab",
}));
const note: api.Note = {
  id: "note",
  title: "服务器",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  schema_version: 3,
  tags: [],
  favorite: false,
  pinned: false,
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
const row: storage.LocalDraft = {
  userId: "user-a",
  workspaceId: "workspace-a",
  key: "previous-tab",
  noteId: note.id,
  tabId: "previous-tab",
  revision: 1,
  updatedAt: 1234,
  body: { ...api.noteInput(note), title: "未保存草稿", tags: ["恢复标签"] },
};
function wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspacePermissionsProvider
      userId="user-a"
      workspaceId="workspace-a"
      permissions={["content.read", "content.write"]}
    >
      {children}
    </WorkspacePermissionsProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.listLocalDrafts).mockResolvedValue([]);
  vi.mocked(storage.putLocalDraft).mockResolvedValue("saved-draft-key");
});
describe("owner-scoped draft recovery", () => {
  it("preserves an unfinished empty title even when its valid body matches the server", async () => {
    const unfinished = {
      ...row,
      body: api.noteInput(note),
      revision: note.revision,
      titleInput: "",
    };
    vi.mocked(storage.listLocalDrafts).mockResolvedValue([unfinished]);
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.localReady).toBe(true));
    expect(result.current.recovery).toHaveLength(1);
    await act(() => result.current.restoreLocal(unfinished));
    expect(result.current.titleInput).toBe("");
    expect(result.current.draft.title).toBe(note.title);
    expect(result.current.state).not.toBe("conflict");
    unmount();
  });
  it("blocks saves pending a recovery choice and turns stale recovery into an explicit conflict", async () => {
    vi.mocked(storage.listLocalDrafts).mockResolvedValue([row]);
    const save = vi.spyOn(api, "saveNote").mockResolvedValue(note);
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.localReady).toBe(true));
    expect(storage.listLocalDrafts).toHaveBeenCalledWith(
      { userId: "user-a", workspaceId: "workspace-a" },
      "note",
    );
    await expect(result.current.flush()).rejects.toThrow("请先恢复或丢弃");
    await act(() => result.current.restoreLocal(row));
    expect(result.current.draft.title).toBe("未保存草稿");
    expect(result.current.draft.tags).toEqual(["恢复标签"]);
    expect(result.current.conflict?.revision).toBe(2);
    expect(result.current.state).toBe("conflict");
    await expect(result.current.flush()).rejects.toThrow("处理保存冲突");
    expect(save).not.toHaveBeenCalled();
    unmount();
    save.mockRestore();
  });
  it("acknowledges only the sent local draft while preserving edits from an in-flight save", async () => {
    let finish!: (value: api.Note) => void;
    const save = vi.spyOn(api, "saveNote").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.localReady).toBe(true));
    act(() => result.current.change({ title: "第一版" }));
    await waitFor(() => expect(storage.putLocalDraft).toHaveBeenCalled());
    const sent = vi.mocked(storage.putLocalDraft).mock.calls[0][0];
    let pending!: Promise<api.Note>;
    await act(async () => {
      pending = result.current.flush();
      await Promise.resolve();
    });
    act(() => result.current.change({ title: "第二版" }));
    await act(async () => {
      finish({ ...note, title: "第一版", revision: 3 });
      await pending;
    });
    await waitFor(() =>
      expect(storage.removeLocalDraft).toHaveBeenCalledWith(
        sent.key,
        sent.updatedAt,
      ),
    );
    expect(result.current.draft.title).toBe("第二版");
    await waitFor(() =>
      expect(storage.putLocalDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          revision: 3,
          body: expect.objectContaining({ title: "第二版" }),
        }),
      ),
    );
    unmount();
    save.mockRestore();
  });
  it("keeps persisted content on 409 and exposes storage failures without deleting drafts", async () => {
    vi.mocked(storage.putLocalDraft).mockRejectedValue(
      new Error("草稿存储失败"),
    );
    const save = vi
      .spyOn(api, "saveNote")
      .mockRejectedValue(
        new ApiError("冲突", { current: { ...note, revision: 4 } }, 409),
      );
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.localReady).toBe(true));
    act(() => result.current.change({ title: "不能丢失" }));
    await waitFor(() => expect(result.current.localError).toBe("草稿存储失败"));
    await act(async () => {
      await result.current.flush().catch(() => {});
    });
    expect(result.current.state).toBe("conflict");
    expect(result.current.draft.title).toBe("不能丢失");
    expect(storage.removeLocalDraft).not.toHaveBeenCalled();
    unmount();
    save.mockRestore();
  });
});
