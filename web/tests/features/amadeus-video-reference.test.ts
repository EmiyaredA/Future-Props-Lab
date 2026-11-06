import { afterEach, expect, test, vi } from "vitest";
import {
  encodeVideoContactSheet,
  MAX_VIDEO_REFERENCE_BYTES,
} from "@features/amadeus/videoReference";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("encodes four or nine frame contact sheets as a bounded JPEG", async () => {
  const bitmap = {
    width: 2000,
    height: 1000,
    close: vi.fn(),
  } as unknown as ImageBitmap;
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["jpeg-bytes"], { type })),
  );

  const result = await encodeVideoContactSheet(
    new Blob(["png"], { type: "image/png" }),
    [0, 1000, 2000, 3000],
  );

  expect(result.mime_type).toBe("image/jpeg");
  expect(result.byte_size).toBe(10);
  expect(result.byte_size).toBeLessThanOrEqual(MAX_VIDEO_REFERENCE_BYTES);
  expect(result.positions_ms).toEqual([0, 1000, 2000, 3000]);
  expect(atob(result.data_base64)).toBe("jpeg-bytes");
  expect(bitmap.close).toHaveBeenCalledOnce();
});

test("rejects invalid timestamps and contact sheets that cannot fit", async () => {
  const bitmap = {
    width: 1000,
    height: 1000,
    close: vi.fn(),
  } as unknown as ImageBitmap;
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["x".repeat(400 * 1024)], { type })),
  );

  await expect(
    encodeVideoContactSheet(new Blob(), [0, 1000, 2000]),
  ).rejects.toThrow("需要 4 或 9");
  await expect(
    encodeVideoContactSheet(new Blob(), [0, -1, 2000, 3000]),
  ).rejects.toThrow("时间点无效");
  await expect(
    encodeVideoContactSheet(new Blob(), [0, 1000, 2000, 3000]),
  ).rejects.toThrow("无法压缩到模型输入限制");
  expect(bitmap.close).toHaveBeenCalledOnce();
});
