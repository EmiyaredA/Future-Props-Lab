import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import { useFileUploads } from "@features/thought-workshop/useFileUploads";
import { parseMarkdown, toMarkdown } from "@features/thought-workshop/markdown";
import { isBackup } from "@features/thought-workshop/archiveFiles";
import * as api from "@features/thought-workshop/api";
import { zipSync, strToU8 } from "fflate";

const uploaded = {
  asset_id: "attachment-id",
  filename: "计划.txt",
  mime_type: "text/plain",
  byte_size: 7,
};
afterEach(() => vi.restoreAllMocks());
it("maps pending attachment position through edits, uploads sequentially, and supports undo/redo", async () => {
  let finish!: (value: typeof uploaded) => void;
  const upload = vi
    .spyOn(api, "uploadAttachment")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...uploaded, asset_id: "second" });
  const editor = new Editor({
    extensions: editorExtensions(),
    content: "<p>原始文字</p>",
  });
  const { result, unmount } = renderHook(() => useFileUploads(editor));
  act(() =>
    result.current.enqueue(
      [new File(["first"], "计划.txt"), new File(["second"], "第二份.txt")],
      5,
    ),
  );
  expect(upload).toHaveBeenCalledTimes(1);
  act(() => {
    editor.commands.insertContentAt(1, "新增");
  });
  await act(async () => {
    finish(uploaded);
  });
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
  expect(upload).toHaveBeenCalledTimes(2);
  const json = editor.getJSON();
  expect(editor.state.doc.firstChild?.textContent).toBe("新增原始文字");
  expect(json.content?.filter((n) => n.type === "attachment")).toHaveLength(2);
  expect(JSON.stringify(json)).not.toContain("uploading");
  act(() => {
    editor.commands.undo();
  });
  expect(
    editor.getJSON().content?.filter((n) => n.type === "attachment"),
  ).toHaveLength(1);
  act(() => {
    editor.commands.redo();
  });
  expect(
    editor.getJSON().content?.filter((n) => n.type === "attachment"),
  ).toHaveLength(2);
  unmount();
  editor.destroy();
});
it("keeps failures retryable and discards completions after leaving a note", async () => {
  let finish!: (value: typeof uploaded) => void;
  const upload = vi
    .spyOn(api, "uploadAttachment")
    .mockRejectedValueOnce(new Error("文件超过上限"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const editor = new Editor({
    extensions: editorExtensions(),
    content: "<p>正文</p>",
  });
  const { result, unmount } = renderHook(() => useFileUploads(editor));
  act(() => result.current.enqueue([new File(["test"], "计划.txt")]));
  await waitFor(() =>
    expect(result.current.entries[0].error).toBe("文件超过上限"),
  );
  expect(editor.getJSON().content?.some((n) => n.type === "attachment")).toBe(
    false,
  );
  act(() => result.current.retry(result.current.entries[0].id));
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[0][1]?.requestId).toBeTruthy();
  expect(upload.mock.calls[1][1]?.requestId).toBe(
    upload.mock.calls[0][1]?.requestId,
  );
  unmount();
  await act(async () => finish(uploaded));
  expect(editor.getJSON().content?.some((n) => n.type === "attachment")).toBe(
    false,
  );
  editor.destroy();
});
it("serializes only filenames and relative links while retaining web links", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "attachment",
        attrs: {
          assetId: "a",
          filename: "计划 [新].txt",
          mimeType: "text/plain",
          byteSize: 7,
        },
      },
    ],
  };
  const markdown = toMarkdown(doc, { a: "attachments/a/plan.txt" });
  expect(markdown).toContain("attachments/a/plan.txt");
  expect(markdown).toContain("计划 \\[新\\].txt");
  const parsed = parseMarkdown(
    markdown + "\n\n[网页](https://example.com)",
    true,
  );
  expect(JSON.stringify(parsed)).toContain("attachments/a/plan.txt");
  expect(JSON.stringify(parsed)).toContain("https://example.com");
  expect(
    JSON.stringify(parseMarkdown("[危险](javascript:alert(1))", true)),
  ).not.toContain('"href":"javascript:');
});
it("recognizes backups without expanding asset contents", async () => {
  const bytes = zipSync({
    "assets/large": new Uint8Array(4 * 1024 * 1024),
    "manifest.json": strToU8('{"format":"thought-workshop-backup"}'),
  });
  // jsdom's File lacks arrayBuffer; the production path uses Blob slices.
  const source = {
    size: bytes.length,
    slice: (from: number, to: number) => ({
      arrayBuffer: async () => bytes.slice(from, to).buffer,
    }),
  } as File;
  expect(await isBackup(source)).toBe(true);
});

it("sends the upload request identifier as an idempotency header", async () => {
  const { api: client } = await import("@platform/api/client");
  const narrowClient = client as unknown as {
    POST: (...args: unknown[]) => Promise<unknown>;
  };
  const post = vi.spyOn(narrowClient, "POST").mockResolvedValue({
    data: { asset_id: "image-id" },
    response: new Response(null, { status: 200 }),
  });
  await api.uploadImage(new File(["image"], "image.png"), {
    requestId: "stable-upload-id",
  });
  expect(post).toHaveBeenCalledWith(
    "/v1/thought-workshop/images",
    expect.objectContaining({
      headers: { "Idempotency-Key": "stable-upload-id" },
    }),
  );
});
