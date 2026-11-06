import { afterEach, expect, test, vi } from "vitest";
import { fetchApiDownload } from "@platform/api/client";
import { downloadNodeOutput } from "@features/visual-workshop/board/downloadNodeOutput";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

vi.mock("@platform/api/client", async () => ({
  ...(await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  )),
  fetchApiDownload: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(fetchApiDownload).mockReset();
});

function captureDownload() {
  const create = vi.fn<(blob: Blob) => string>(() => "blob:download");
  const revoke = vi.fn();
  const captured: { filename?: string; href?: string } = {};
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    captured.filename = this.download;
    captured.href = this.href;
  });
  return { create, revoke, captured };
}

test("media downloads use authenticated file download and the server filename with its original extension", async () => {
  const { create, revoke, captured } = captureDownload();
  const blob = new Blob(["image"], { type: "image/png" });
  vi.mocked(fetchApiDownload).mockResolvedValue({ blob, filename: "角色.png" });
  await downloadNodeOutput({
    id: "node",
    kind: "image",
    title: "角色",
    asset_id: "asset",
    position: { x: 0, y: 0 },
  });
  expect(fetchApiDownload).toHaveBeenCalledExactlyOnceWith(
    "/v1/files/asset/download?download_name=%E8%A7%92%E8%89%B2",
  );
  expect(create).toHaveBeenCalledWith(blob);
  expect(captured).toEqual({ filename: "角色.png", href: "blob:download" });
  expect(revoke).toHaveBeenCalledWith("blob:download");
  expect(document.querySelector("a[download]")).toBeNull();
});

test("text exports the current text as a TXT file without a network call", async () => {
  const { create, captured, revoke } = captureDownload();
  await downloadNodeOutput({
    id: "node",
    kind: "text",
    title: "人物/说明",
    text: "当前角色设定",
    position: { x: 0, y: 0 },
  });
  expect(fetchApiDownload).not.toHaveBeenCalled();
  expect(captured.filename).toBe("人物_说明.txt");
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(revoke).toHaveBeenCalledOnce();
});

test("empty content and download failures do not produce a partial local download", async () => {
  const { create } = captureDownload();
  const node: VisualCanvasNode = {
    id: "node",
    kind: "video",
    title: "视频",
    position: { x: 0, y: 0 },
  };
  await expect(downloadNodeOutput(node)).rejects.toThrow("暂无可下载内容");
  vi.mocked(fetchApiDownload).mockRejectedValue(new Error("素材不可用"));
  await expect(
    downloadNodeOutput({ ...node, asset_id: "gone" }),
  ).rejects.toThrow("素材不可用");
  expect(create).not.toHaveBeenCalled();
});
