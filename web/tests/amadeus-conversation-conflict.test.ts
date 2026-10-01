import { describe, expect, it, vi } from "vitest";
import { ApiError, fetchApiJson } from "@platform/api/client";
import { conversationActions } from "@features/amadeus/conversationActions";
import type { Conversation } from "@features/amadeus/protocol";

vi.mock("@platform/api/client", async (load) => ({
  ...(await load<typeof import("@platform/api/client")>()),
  fetchApiJson: vi.fn(),
}));

describe("Amadeus conversation conflict", () => {
  it("retains the rename dialog and loads the current revision without resubmitting", async () => {
    const item = { id: "one", title: "旧标题", revision: 1 } as Conversation;
    const current = { ...item, title: "其他窗口的标题", revision: 2 };
    vi.mocked(fetchApiJson).mockRejectedValueOnce(
      new ApiError("内容已更新", { code: "revision_conflict", current }, 409),
    );
    const refreshList = vi.fn(async () => [current]);
    const open = vi.fn(async () => undefined);
    const setRenameItem = vi.fn();
    const setError = vi.fn();
    const actions = conversationActions({
      detailRef: { current: { conversation: item, messages: [], actions: [] } },
      busy: false,
      filesOpen: false,
      refreshList,
      open,
      setDetail: vi.fn(),
      setError,
      setRenameItem,
      setDeleteItem: vi.fn(),
      setAttachments: vi.fn(),
      setReferences: vi.fn(),
      setFilesOpen: vi.fn(),
      setWorkFiles: vi.fn(),
      setFilePreview: vi.fn(),
    } as unknown as Parameters<typeof conversationActions>[0]);
    await actions.rename(item, "尚未发送的新标题");
    expect(fetchApiJson).toHaveBeenCalledTimes(1);
    expect(setRenameItem).toHaveBeenCalledWith(current);
    expect(setRenameItem).not.toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenCalledWith(expect.stringContaining("重新提交"));
    expect(refreshList).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("one");
  });
});
