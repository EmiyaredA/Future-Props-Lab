import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CanvasImageCrop } from "@features/visual-workshop/canvas/CanvasImageCrop";
import { exportImageCrop } from "@features/visual-workshop/canvas/imageCropExport";
import { uploadManagedFile, type ManagedFile } from "@features/files";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

vi.mock("@features/files", async () => ({
  ...(await vi.importActual("@features/files")),
  uploadManagedFile: vi.fn(),
  invalidateFileScope: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({ useApiBlobUrl: vi.fn() }));
const drawImage = vi.fn();
const decode = vi.fn();
const close = vi.fn();
const image = { width: 800, height: 600, close } as unknown as ImageBitmap;
const asset = { id: "crop-asset", display_name: "原图-裁剪" } as ManagedFile;

beforeEach(() => {
  vi.clearAllMocks();
  decode.mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(image));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["pixels"], { type })),
  );
  vi.mocked(useApiBlobUrl).mockReturnValue({
    url: "blob:original",
    loading: false,
    error: null,
  });
  vi.mocked(uploadManagedFile).mockResolvedValue(asset);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(onAdd = vi.fn().mockResolvedValue(undefined)) {
  const onCancel = vi.fn(),
    onSaved = vi.fn();
  const result = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CanvasImageCrop
        projectId="project"
        assetId="original"
        title="原图.jpg"
        onCancel={onCancel}
        onSaved={onSaved}
        onAdd={onAdd}
      />
    </QueryClientProvider>,
  );
  return { ...result, onCancel, onSaved, onAdd };
}

test("exports original pixel bounds to PNG without scaling to the viewport", async () => {
  const file = await exportImageCrop(
    image,
    image,
    { x: 20, y: 30, width: 350, height: 210 },
    "原图.jpg",
  );
  expect(drawImage).toHaveBeenCalledWith(
    image,
    20,
    30,
    350,
    210,
    0,
    0,
    350,
    210,
  );
  expect(file.name).toBe("原图-裁剪.png");
  expect(file.type).toBe("image/png");
});

test("changes ratio, adjusts edges by keyboard and resets without uploading", async () => {
  const user = userEvent.setup();
  const { onCancel } = mount();
  await screen.findByRole("group", { name: /裁剪选区/ });
  expect(screen.getByLabelText("裁剪尺寸")).toHaveTextContent("800 × 600");
  await user.click(screen.getByRole("combobox", { name: "裁剪比例" }));
  await user.click(screen.getByRole("option", { name: "1:1" }));
  expect(screen.getByLabelText("裁剪尺寸")).toHaveTextContent("600 × 600");
  fireEvent.keyDown(screen.getByRole("button", { name: "调整裁剪右下角" }), {
    key: "ArrowLeft",
    shiftKey: true,
  });
  expect(screen.getByLabelText("裁剪尺寸")).toHaveTextContent("590 × 590");
  await user.click(screen.getByRole("button", { name: "重置" }));
  expect(screen.getByLabelText("裁剪尺寸")).toHaveTextContent("800 × 600");
  fireEvent.keyDown(screen.getByRole("group", { name: /裁剪选区/ }), {
    key: "Escape",
  });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(uploadManagedFile).not.toHaveBeenCalled();
});

test("retains uploaded asset on a canvas error and prevents concurrent submission", async () => {
  const onAdd = vi
    .fn()
    .mockRejectedValueOnce(new Error("画布保存失败"))
    .mockResolvedValue(undefined);
  const { onSaved } = mount(onAdd);
  const button = screen.getByRole("button", { name: "裁剪并添加到画布" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByRole("alert");
  expect(uploadManagedFile).toHaveBeenCalledOnce();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "重置" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试保存到画布" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(uploadManagedFile).toHaveBeenCalledOnce();
  expect(onAdd.mock.calls).toEqual([[asset], [asset]]);
});

test("upload failure leaves crop editable and retryable", async () => {
  vi.mocked(uploadManagedFile).mockRejectedValueOnce(new Error("上传失败"));
  const { onAdd } = mount();
  const button = screen.getByRole("button", { name: "裁剪并添加到画布" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("上传失败");
  expect(screen.getByRole("button", { name: "重置" })).toBeEnabled();
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
});

test("decode failure can be retried, and the decoded bitmap is released", async () => {
  decode.mockRejectedValueOnce(new Error("bad image"));
  const { unmount } = mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("图片无法解码");
  expect(
    screen.getByRole("button", { name: "裁剪并添加到画布" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByRole("group", { name: /裁剪选区/ });
  unmount();
  expect(close).toHaveBeenCalledOnce();
});

test("missing asset blocks export; cancelling during loading has no write", async () => {
  vi.mocked(useApiBlobUrl).mockReturnValue({
    url: "",
    loading: false,
    error: new Error("素材不存在"),
  });
  const { onCancel } = mount();
  expect(screen.getByRole("alert")).toHaveTextContent("素材不存在");
  expect(
    screen.getByRole("button", { name: "裁剪并添加到画布" }),
  ).toBeDisabled();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "取消" })),
  );
  expect(onCancel).toHaveBeenCalledOnce();
  expect(uploadManagedFile).not.toHaveBeenCalled();
});
