import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { useReadingPosition } from "@features/thought-workshop/knowledge-tools/ReadingPosition";
import * as api from "@features/thought-workshop/knowledge-tools/api";

vi.mock("@features/thought-workshop/knowledge-tools/api", () => ({
  getReading: vi.fn().mockResolvedValue(null),
  recordReading: vi.fn().mockResolvedValue(undefined),
}));

function Reader({ id }: { id: string }) {
  const root = useReadingPosition(id, "当前文章", 3);
  return (
    <main ref={root} style={{ overflowY: "auto" }}>
      <p>可以恢复的段落</p>
    </main>
  );
}
function Owner({
  user,
  workspace,
  id,
}: {
  user: string;
  workspace: string;
  id: string;
}) {
  return (
    <WorkspacePermissionsProvider
      userId={user}
      workspaceId={workspace}
      permissions={["content.read"]}
    >
      <Reader id={id} />
    </WorkspacePermissionsProvider>
  );
}
afterEach(() => vi.clearAllMocks());

describe("personal reading ownership", () => {
  it("does not record the new article's DOM as the previous article's reading position", async () => {
    const view = render(
      <Owner user="user-a" workspace="workspace-a" id="note-a" />,
    );
    await waitFor(() => expect(api.recordReading).toHaveBeenCalled());
    vi.mocked(api.recordReading).mockClear();
    view.rerender(<Owner user="user-a" workspace="workspace-a" id="note-b" />);
    expect(api.recordReading).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(api.recordReading).toHaveBeenCalledWith(
        "note-b",
        "当前文章",
        expect.any(Object),
      ),
    );
    view.unmount();
  });
  it("does not flush the previous user's location through the new account after switching", async () => {
    const view = render(
      <Owner user="user-a" workspace="workspace-a" id="note-a" />,
    );
    await waitFor(() =>
      expect(api.recordReading).toHaveBeenCalledWith(
        "note-a",
        "当前文章",
        expect.objectContaining({ note_revision: 3 }),
      ),
    );
    vi.mocked(api.recordReading).mockClear();
    view.rerender(<Owner user="user-b" workspace="workspace-b" id="note-b" />);
    expect(api.recordReading).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(api.recordReading).toHaveBeenCalledWith(
        "note-b",
        "当前文章",
        expect.any(Object),
      ),
    );
    expect(
      vi.mocked(api.recordReading).mock.calls.every(([id]) => id === "note-b"),
    ).toBe(true);
    view.unmount();
  });
});
