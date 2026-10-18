import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { SlideImageVersion } from "@features/presentation-workshop/SlideImageVersion";
import { newSlide, copySlide } from "@features/presentation-workshop/templates";
import type { Slide } from "@features/presentation-workshop/types";

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  image: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@features/presentation-workshop/api", () => ({
  uploadImage: api.upload,
  imageBlob: api.image,
  download: api.download,
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "blob:archived", error: null }),
}));
vi.mock("@features/presentation-workshop/PresentationImages", () => ({
  PresentationImages: (props: {
    onChoose: (id: string) => void;
    onUpload: (file: File) => void;
    onClose: () => void;
    error: string;
  }) => (
    <div role="dialog" aria-label="选择本页图像版本">
      <button onClick={() => props.onChoose("library-image")}>
        归档库图片
      </button>
      <button
        onClick={() =>
          props.onUpload(
            new File(["image"], "image.png", { type: "image/png" }),
          )
        }
      >
        上传生成图
      </button>
      <button onClick={props.onClose}>关闭选择器</button>
      <p>{props.error}</p>
    </div>
  ),
}));
vi.mock("@features/presentation-workshop/MediaPreview", () => ({
  MediaPreview: (props: { id: string; onClose: () => void }) => (
    <div role="dialog" aria-label="原图预览">
      {props.id}
      <button onClick={props.onClose}>关闭预览</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.resetAllMocks();
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

function Controlled({ initial = newSlide() }: { initial?: Slide }) {
  const [slide, setSlide] = useState(initial);
  return (
    <SlideImageVersion
      slide={slide}
      readOnly={false}
      onChange={(image_asset_id) => setSlide((s) => ({ ...s, image_asset_id }))}
    />
  );
}

it("按页选择归档图、预览、下载和移除，不改变页面元素或参考图", async () => {
  const slide = newSlide("cover");
  slide.reference = {
    asset_id: "separate-reference",
    mode: "side",
    opacity: 0.35,
    visible: true,
  };
  const before = structuredClone(slide);
  render(<Controlled initial={slide} />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "添加图像版本" }));
  fireEvent.click(screen.getByRole("button", { name: "归档库图片" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "预览图像版本" }));
  expect(
    screen.getByRole("dialog", { name: "原图预览" }).textContent,
  ).toContain("library-image");
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  const blob = new Blob(["png"], { type: "image/png" });
  api.image.mockResolvedValue(blob);
  fireEvent.click(screen.getByRole("button", { name: "下载图像" }));
  await waitFor(() =>
    expect(api.download).toHaveBeenCalledWith(
      blob,
      `幻灯片图像-${slide.id}.png`,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "移除图像版本" }));
  expect(screen.getByText("未添加图像版本")).toBeTruthy();
  expect(slide).toEqual(before);
  expect(
    copySlide({ ...slide, image_asset_id: "copy-image" }).image_asset_id,
  ).toBe("copy-image");
});

it("上传成功关联图像，上传失败保留已有归档并显示错误", async () => {
  const onChange = vi.fn();
  const slide = { ...newSlide(), image_asset_id: "existing" };
  render(
    <SlideImageVersion slide={slide} readOnly={false} onChange={onChange} />,
    { wrapper },
  );
  fireEvent.click(screen.getByRole("button", { name: "更换图像版本" }));
  api.upload.mockRejectedValueOnce(new Error("网络断开"));
  fireEvent.click(screen.getByRole("button", { name: "上传生成图" }));
  await screen.findByRole("alert");
  expect(onChange).not.toHaveBeenCalled();
  api.upload.mockResolvedValueOnce({ id: "uploaded" });
  fireEvent.click(screen.getByRole("button", { name: "上传生成图" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("uploaded"));
});

it.each(["关闭选择器", "切页", "撤销权限"])(
  "上传过程中%s，迟到结果不能修改页面",
  async (action) => {
    let resolve!: (asset: { id: string }) => void;
    api.upload.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const onChange = vi.fn();
    const slide = newSlide();
    const view = render(
      <SlideImageVersion
        key={slide.id}
        slide={slide}
        readOnly={false}
        onChange={onChange}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "添加图像版本" }));
    fireEvent.click(screen.getByRole("button", { name: "上传生成图" }));
    if (action === "关闭选择器")
      fireEvent.click(screen.getByRole("button", { name: action }));
    if (action === "切页") {
      const next = newSlide();
      view.rerender(
        <SlideImageVersion
          key={next.id}
          slide={next}
          readOnly={false}
          onChange={onChange}
        />,
      );
    }
    if (action === "撤销权限")
      view.rerender(
        <SlideImageVersion
          key={slide.id}
          slide={slide}
          readOnly
          onChange={onChange}
        />,
      );
    await act(async () => {
      resolve({ id: "late-upload" });
    });
    expect(onChange).not.toHaveBeenCalled();
  },
);

it("只读用户能预览与下载，不能添加、替换或移除", () => {
  render(
    <SlideImageVersion
      slide={{ ...newSlide(), image_asset_id: "saved" }}
      readOnly
      onChange={vi.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByRole("button", { name: "预览图像版本" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "下载图像" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /更换|移除|添加/ })).toBeNull();
});
