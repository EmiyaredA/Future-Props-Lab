import { Editor } from "@tiptap/core";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { AllSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import {
  clearSessionThoughtClipboard,
  insertThoughtClipboardPayload,
  pasteThoughtClipboard,
  pasteThoughtHTML,
  peekSessionThoughtClipboard,
  readThoughtClipboardPayload,
  sanitizeThoughtPastedHTML,
  THOUGHT_CLIPBOARD_MIME,
  THOUGHT_CLIPBOARD_WEB_MIME,
  writeThoughtClipboard,
} from "@features/thought-workshop/clipboard";
import { copyBlockSelection } from "@features/thought-workshop/blockCommands";

const { fetchApiBlob, uploadImage } = vi.hoisted(() => ({
  fetchApiBlob: vi.fn(),
  uploadImage: vi.fn(),
}));

function imageBlob() {
  return {
    type: "image/png",
    size: 11,
    arrayBuffer: async () => new TextEncoder().encode("image-bytes").buffer,
  } as unknown as Blob;
}

async function blobText(value: Blob | Promise<Blob>) {
  return (await value).text();
}

class ClipboardBlob {
  readonly type: string;
  readonly size: number;
  private readonly value: string;

  constructor(parts: unknown[], options?: { type?: string }) {
    this.value = parts.map(String).join("");
    this.size = this.value.length;
    this.type = options?.type ?? "";
  }

  async text() {
    return this.value;
  }
}

vi.mock("@platform/api/client", () => ({ fetchApiBlob }));
vi.mock("@features/thought-workshop/api", () => ({ uploadImage }));

class ClipboardItemMock {
  constructor(public readonly data: Record<string, Blob | Promise<Blob>>) {}
}

function imageEditor(assetId = "asset-a") {
  return new Editor({
    extensions: editorExtensions(),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        {
          type: "image",
          attrs: {
            assetId,
            alt: "架构图",
            width: 320,
            caption: "图注",
            align: "center",
          },
        },
      ],
    },
  });
}

function imageSelection(editor: Editor) {
  const position = editor.state.doc.child(0).nodeSize;
  editor.view.dispatch(
    editor.state.tr.setSelection(
      NodeRangeSelection.create(
        editor.state.doc,
        position,
        position + editor.state.doc.child(1).nodeSize,
      ),
    ),
  );
}

function selectAll(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
  );
}

function clipboardData(raw: string): DataTransfer {
  return {
    files: [] as unknown as FileList,
    types: [THOUGHT_CLIPBOARD_MIME],
    getData: (type: string) => (type === THOUGHT_CLIPBOARD_MIME ? raw : ""),
  } as unknown as DataTransfer;
}

afterEach(() => {
  clearSessionThoughtClipboard();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchApiBlob.mockReset();
  uploadImage.mockReset();
});

beforeEach(() => {
  clearSessionThoughtClipboard();
  vi.stubGlobal("Blob", ClipboardBlob);
});

describe("思绪工坊应用内剪贴板", () => {
  it("copies managed image bytes with the Chromium web-prefixed custom type", async () => {
    fetchApiBlob.mockResolvedValue(imageBlob());
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const editor = imageEditor();
    imageSelection(editor);

    await copyBlockSelection(editor, "kb-source");
    const item = write.mock.calls[0][0][0] as ClipboardItemMock;
    expect(item.data[THOUGHT_CLIPBOARD_WEB_MIME]).toBeTruthy();
    expect(item.data[THOUGHT_CLIPBOARD_MIME]).toBeUndefined();
    const payload = JSON.parse(
      await blobText(item.data[THOUGHT_CLIPBOARD_WEB_MIME]),
    );
    expect(payload.sourceScopeId).toBe("kb-source");
    expect(payload.assets["asset-a"].data).toBeTruthy();
    await expect(blobText(item.data["text/html"])).resolves.toContain(
      "data:image/png;base64,",
    );
    expect(item.data["text/plain"]).toBeInstanceOf(Blob);
    expect(peekSessionThoughtClipboard()?.sourceScopeId).toBe("kb-source");
    editor.destroy();
  });

  it("falls back to HTML and plain text when the custom clipboard type is rejected", async () => {
    fetchApiBlob.mockResolvedValue(imageBlob());
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported type"))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const editor = imageEditor();
    imageSelection(editor);

    await writeThoughtClipboard(editor, "kb-source");
    expect(write).toHaveBeenCalledTimes(2);
    const fallback = write.mock.calls[1][0][0] as ClipboardItemMock;
    expect(fallback.data[THOUGHT_CLIPBOARD_WEB_MIME]).toBeUndefined();
    await expect(blobText(fallback.data["text/html"])).resolves.toContain(
      "data:image/png;base64,",
    );
    expect(peekSessionThoughtClipboard()?.assets["asset-a"]).toBeTruthy();
    editor.destroy();
  });

  it("reuses an image in the same knowledge base and preserves its attributes", async () => {
    fetchApiBlob.mockResolvedValue(imageBlob());
    const source = imageEditor();
    imageSelection(source);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    await copyBlockSelection(source, "kb-1");
    const item = write.mock.calls[0][0][0] as ClipboardItemMock;
    const raw = await blobText(item.data[THOUGHT_CLIPBOARD_WEB_MIME]);

    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await pasteThoughtClipboard(target, clipboardData(raw), "kb-1");
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({
            assetId: "asset-a",
            width: 320,
            caption: "图注",
            align: "center",
          }),
        }),
      ]),
    );
    expect(uploadImage).not.toHaveBeenCalled();
    source.destroy();
    target.destroy();
  });

  it("uploads all images before inserting when the target knowledge base differs", async () => {
    fetchApiBlob.mockResolvedValue(imageBlob());
    uploadImage.mockResolvedValue({ asset_id: "asset-new" });
    const source = imageEditor();
    imageSelection(source);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    await copyBlockSelection(source, "kb-source");
    const item = write.mock.calls[0][0][0] as ClipboardItemMock;
    const raw = await blobText(item.data[THOUGHT_CLIPBOARD_WEB_MIME]);
    const payload = JSON.parse(raw);
    expect(payload.assets["asset-a"].filename).toMatch(/\.png$/i);
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    await pasteThoughtClipboard(target, clipboardData(raw), "kb-target");
    expect(uploadImage).toHaveBeenCalledTimes(1);
    const uploaded = uploadImage.mock.calls[0][0] as File;
    expect(uploaded.name).toMatch(/\.png$/i);
    expect(uploaded.type).toBe("image/png");
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-new" }),
        }),
      ]),
    );
    source.destroy();
    target.destroy();
  });

  it("adds an image extension when migrating a payload whose filename is only alt text", async () => {
    uploadImage.mockResolvedValue({ asset_id: "asset-ext" });
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const raw = JSON.stringify({
      version: 1,
      sourceScopeId: "kb-source",
      fragment: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { assetId: "asset-a", alt: "架构图" },
          },
        ],
      },
      assets: {
        "asset-a": {
          mimeType: "image/png",
          data: "iVBORw0KGgo=",
          filename: "架构图",
        },
      },
    });
    await pasteThoughtClipboard(target, clipboardData(raw), "kb-target");
    const uploaded = uploadImage.mock.calls[0][0] as File;
    expect(uploaded.name).toBe("架构图.png");
    target.destroy();
  });

  it("migrates a full-document TextSelection across knowledge bases", async () => {
    fetchApiBlob.mockResolvedValue(imageBlob());
    uploadImage.mockResolvedValue({ asset_id: "asset-select-all" });
    const source = imageEditor();
    selectAll(source);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    await writeThoughtClipboard(source, "kb-source");
    const session = peekSessionThoughtClipboard();
    expect(session?.fragment.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "paragraph" }),
        expect.objectContaining({ type: "image" }),
      ]),
    );

    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await insertThoughtClipboardPayload(target, session!, "kb-target");
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "paragraph",
          content: [expect.objectContaining({ text: "前文" })],
        }),
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-select-all" }),
        }),
      ]),
    );
    source.destroy();
    target.destroy();
  });

  it("reads the web-prefixed custom format through clipboard.read", async () => {
    const payload = {
      version: 1,
      sourceScopeId: "kb-source",
      fragment: {
        type: "doc",
        content: [{ type: "image", attrs: { assetId: "asset-a" } }],
      },
      assets: {
        "asset-a": { mimeType: "image/png", data: "YQ==", filename: "a.png" },
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          {
            types: [THOUGHT_CLIPBOARD_WEB_MIME],
            getType: vi
              .fn()
              .mockResolvedValue(new ClipboardBlob([JSON.stringify(payload)])),
          },
        ]),
      },
    });
    await expect(readThoughtClipboardPayload()).resolves.toEqual(payload);
  });

  it("migrates the validated HTML fallback when the custom clipboard type is unavailable", async () => {
    uploadImage.mockResolvedValue({ asset_id: "asset-from-html" });
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await pasteThoughtHTML(
      target,
      '<figure data-thought-image="true"><img data-asset-id="asset-a" data-fpl-source-scope="kb-source" alt="图" src="data:image/png;base64,YQ=="></figure>',
      "kb-target",
    );
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-from-html" }),
        }),
      ]),
    );
    target.destroy();
  });

  it("reuploads inline images when the browser strips the source scope marker", async () => {
    uploadImage.mockResolvedValue({ asset_id: "asset-from-unknown-scope" });
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await pasteThoughtHTML(
      target,
      '<figure data-thought-image="true"><img data-asset-id="asset-a" alt="图" src="data:image/png;base64,YQ=="></figure>',
      "kb-target",
    );
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({
            assetId: "asset-from-unknown-scope",
          }),
        }),
      ]),
    );
    target.destroy();
  });

  it("migrates thought figures when the browser strips data-asset-id but keeps inline data", async () => {
    uploadImage.mockResolvedValue({ asset_id: "asset-from-stripped-id" });
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await pasteThoughtHTML(
      target,
      '<figure data-thought-image="true"><img alt="图" src="data:image/png;base64,YQ=="></figure>',
      "kb-target",
    );
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-from-stripped-id" }),
        }),
      ]),
    );
    target.destroy();
  });

  it("uploads one copy when the same HTML image appears more than once", async () => {
    uploadImage.mockResolvedValue({ asset_id: "asset-deduplicated" });
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await pasteThoughtHTML(
      target,
      '<p><img data-asset-id="asset-a" alt="图" src="data:image/png;base64,YQ=="></p><p><img data-asset-id="asset-a" alt="图" src="data:image/png;base64,YQ=="></p>',
      "kb-target",
    );
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(
      target.getJSON().content?.filter((node) => node.type === "image"),
    ).toHaveLength(2);
    expect(target.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          attrs: expect.objectContaining({ assetId: "asset-deduplicated" }),
        }),
      ]),
    );
    target.destroy();
  });

  it("rejects managed HTML without migration data before changing the document", async () => {
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const before = target.getJSON();
    await expect(
      pasteThoughtHTML(
        target,
        '<figure data-thought-image="true"><img data-asset-id="asset-a" alt="图"></figure>',
        "kb-target",
      ),
    ).rejects.toThrow("缺少可迁移数据");
    expect(target.getJSON()).toEqual(before);
    expect(uploadImage).not.toHaveBeenCalled();
    target.destroy();
  });

  it("does not insert a partial selection when an image migration fails", async () => {
    uploadImage.mockRejectedValue(new Error("上传失败"));
    const target = new Editor({
      extensions: editorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const before = target.getJSON();
    const raw = JSON.stringify({
      version: 1,
      sourceScopeId: "kb-source",
      fragment: {
        type: "doc",
        content: [
          { type: "image", attrs: { assetId: "asset-a" } },
          { type: "image", attrs: { assetId: "asset-b" } },
        ],
      },
      assets: {
        "asset-a": { mimeType: "image/png", data: "YQ==", filename: "a.png" },
        "asset-b": { mimeType: "image/png", data: "Yg==", filename: "b.png" },
      },
    });
    await expect(
      pasteThoughtClipboard(target, clipboardData(raw), "kb-target"),
    ).rejects.toThrow("上传失败");
    expect(target.getJSON()).toEqual(before);
    target.destroy();
  });

  it("keeps same-scope managed images but removes external images and unsafe attributes", () => {
    const html =
      '<p onclick="evil()">text</p><figure data-thought-image="true" data-align="center" data-unknown="x"><img data-asset-id="asset-a" data-fpl-source-scope="kb-1" src="https://example.com/tracker.gif" onerror="evil()"></figure><img src="https://example.com/external.png">';
    const result = sanitizeThoughtPastedHTML(html, "kb-1");
    expect(result).toContain('data-asset-id="asset-a"');
    expect(result).not.toContain("tracker.gif");
    expect(result).not.toContain("external.png");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("data-unknown");
  });
});
