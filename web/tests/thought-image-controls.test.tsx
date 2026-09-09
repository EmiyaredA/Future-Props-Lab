import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManagedImageView } from "@features/thought-workshop/ManagedImageView";
import type { NodeViewProps } from "@tiptap/react";

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "blob:image", loading: false, error: null }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderImage(
  attrs: Record<string, unknown>,
  { selected = true, editable = true } = {},
) {
  const updateAttributes = vi.fn();
  const props = {
    node: { attrs },
    selected,
    updateAttributes,
    editor: { isEditable: editable },
    getPos: () => 0,
    deleteNode: () => {},
    extension: {},
    decorations: [],
    view: {},
    innerDecorations: {},
    HTMLAttributes: {},
  } as unknown as NodeViewProps;
  const result = render(<ManagedImageView {...props} />);
  return { ...result, updateAttributes };
}

function loadCropImage(width = 200, height = 100) {
  const dialog = screen.getByRole("dialog", { name: "裁剪图片" });
  const image = dialog.querySelector("img")!;
  Object.defineProperty(image, "naturalWidth", { value: width });
  Object.defineProperty(image, "naturalHeight", { value: height });
  fireEvent.load(image);
  return dialog;
}

it("shows a free-text caption and updates width, alt, caption, and alignment", () => {
  const { updateAttributes } = renderImage({
    assetId: "image-id",
    width: 480,
    alt: "替代",
    caption: "可见图注",
  });
  expect(screen.getByText("可见图注")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("图片宽度"), {
    target: { value: "2400" },
  });
  expect(updateAttributes).toHaveBeenCalledWith({ width: 2000 });
  fireEvent.change(screen.getByLabelText("图片替代文字"), {
    target: { value: "新替代" },
  });
  expect(updateAttributes).toHaveBeenCalledWith({ alt: "新替代" });
  fireEvent.change(screen.getByLabelText("图片图注"), {
    target: { value: "" },
  });
  expect(updateAttributes).toHaveBeenCalledWith({ caption: "" });
  fireEvent.click(screen.getByRole("button", { name: "图片居中" }));
  expect(updateAttributes).toHaveBeenCalledWith({ align: "center" });
  expect(screen.getByRole("button", { name: "图片左对齐" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("applies ratio crops and supports keyboard movement and handle resizing", () => {
  const { updateAttributes } = renderImage({
    assetId: "image-id",
    width: 480,
    alt: "替代",
    caption: "",
  });
  fireEvent.click(screen.getByRole("button", { name: "裁剪" }));
  const dialog = loadCropImage();
  fireEvent.click(within(dialog).getByRole("button", { name: "1:1" }));
  const selection = within(dialog).getByRole("group", {
    name: "移动裁剪区域",
  });
  expect(selection).toHaveStyle({ left: "25%", width: "50%" });
  fireEvent.keyDown(selection, { key: "ArrowRight" });
  expect(selection).toHaveStyle({ left: "26%" });
  fireEvent.keyDown(
    within(dialog).getByRole("button", { name: "调整裁剪区域右下角" }),
    { key: "ArrowLeft" },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "应用裁剪" }));
  expect(updateAttributes).toHaveBeenCalledWith(
    expect.objectContaining({
      cropLeft: expect.any(Number),
      cropTop: expect.any(Number),
      cropWidth: expect.any(Number),
      cropHeight: expect.any(Number),
    }),
  );
});

it("supports drawing a free crop and discards it when cancelled", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const { updateAttributes } = renderImage({
    assetId: "image-id",
    width: 480,
    alt: "",
    caption: "",
  });
  fireEvent.click(screen.getByRole("button", { name: "裁剪" }));
  const dialog = loadCropImage();
  const frame = dialog.querySelector<HTMLElement>(".thought-image-crop-frame")!;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 100,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(frame, { pointerId: 1, clientX: 20, clientY: 10 });
  fireEvent.pointerMove(frame, { pointerId: 1, clientX: 160, clientY: 80 });
  fireEvent.pointerUp(frame, { pointerId: 1 });
  const selection = within(dialog).getByRole("group", {
    name: "移动裁剪区域",
  });
  expect(selection).toHaveStyle({ left: "10%", top: "10%", width: "70%" });
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(updateAttributes).not.toHaveBeenCalled();
});

it("clears crop attrs from the toolbar and when a full crop is applied", () => {
  const attrs = {
    assetId: "image-id",
    width: 480,
    alt: "",
    caption: "",
    cropLeft: 10,
    cropTop: 10,
    cropWidth: 50,
    cropHeight: 50,
  };
  const first = renderImage(attrs);
  fireEvent.click(screen.getByRole("button", { name: "重置裁剪" }));
  expect(first.updateAttributes).toHaveBeenCalledWith({
    cropLeft: null,
    cropTop: null,
    cropWidth: null,
    cropHeight: null,
  });
  first.unmount();

  const second = renderImage(attrs);
  fireEvent.click(screen.getByRole("button", { name: "裁剪" }));
  const dialog = loadCropImage();
  fireEvent.click(within(dialog).getByRole("button", { name: "重置" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "应用裁剪" }));
  expect(second.updateAttributes).toHaveBeenCalledWith({
    cropLeft: null,
    cropTop: null,
    cropWidth: null,
    cropHeight: null,
  });
});

it("keeps captions visible while hiding editing controls in read-only mode", () => {
  renderImage(
    {
      assetId: "image-id",
      width: 480,
      alt: "",
      caption: "只读图注",
      align: "right",
    },
    { selected: false, editable: false },
  );
  expect(screen.getByText("只读图注")).toBeInTheDocument();
  expect(screen.queryByRole("toolbar", { name: "图片操作" })).toBeNull();
  expect(screen.queryByLabelText("图片图注")).toBeNull();
  expect(document.querySelector(".thought-image-align-right")).toBeTruthy();
});
