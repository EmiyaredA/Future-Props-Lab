import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchApiDownload,
  filenameFromContentDisposition,
} from "@platform/api/client";
import {
  downloadProjectSnapshot,
  ProjectEditorDialog,
  type ProjectEditorState,
} from "@shared/ui/project-library";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("API downloads", () => {
  it("prefers UTF-8 response filenames and sanitizes path separators", () => {
    expect(
      filenameFromContentDisposition(
        "attachment; filename=project.zip; filename*=UTF-8''%E5%89%AA%E8%BE%91%2F%E5%B7%A5%E7%A8%8B.zip",
      ),
    ).toBe("剪辑_工程.zip");
    expect(
      filenameFromContentDisposition(
        'attachment; filename="quoted snapshot.zip"',
      ),
    ).toBe("quoted snapshot.zip");
    expect(filenameFromContentDisposition(null)).toBeNull();
  });

  it("returns the blob and server filename from an exposed response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("snapshot", {
            headers: {
              "Content-Disposition":
                "attachment; filename*=UTF-8''story-snapshot.zip",
            },
          }),
      ),
    );
    const result = await fetchApiDownload("/v1/example/snapshot");
    expect(result.filename).toBe("story-snapshot.zip");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(8);
  });

  it("revokes the temporary object URL after triggering a download", () => {
    const createObjectURL = vi.fn(() => "blob:snapshot");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    downloadProjectSnapshot({
      blob: new Blob(["snapshot"]),
      filename: "server-snapshot.zip",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:snapshot");
  });
});

function DialogHarness() {
  const project = { id: "project", title: "可访问项目" };
  const [editor, setEditor] = useState<ProjectEditorState<
    typeof project
  > | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setEditor({ mode: "rename", project, title: project.title })
        }
      >
        打开重命名
      </button>
      {editor ? (
        <ProjectEditorDialog
          editor={editor}
          noun="项目"
          pending={false}
          deleteDescription="删除后不可恢复"
          onTitleChange={(title) =>
            editor.mode === "rename" && setEditor({ ...editor, title })
          }
          onCancel={() => setEditor(null)}
          onRename={() => undefined}
          onDelete={() => undefined}
        />
      ) : null}
    </>
  );
}

it("closes project dialogs with Escape and restores opener focus", async () => {
  const user = userEvent.setup();
  render(<DialogHarness />);
  const opener = screen.getByRole("button", { name: "打开重命名" });
  await user.click(opener);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(opener).toHaveFocus();
});
