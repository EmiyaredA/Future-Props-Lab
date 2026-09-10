import { readFileSync } from "node:fs";
import { act, fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { coverCrop } from "@features/presentation-workshop/imageCrop";
import { ElementImage } from "@features/presentation-workshop/SlideSurface";
import { newElement } from "@features/presentation-workshop/templates";
import type { SlideElement } from "@features/presentation-workshop/types";

const blobState = vi.hoisted(() => ({ url: "blob:one", error: null }));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => blobState,
}));
const cases = JSON.parse(
  readFileSync("../tests/fixtures/presentation_crop_cases.json", "utf8"),
) as {
  name: string;
  image: [number, number];
  frame: [number, number];
  crop: SlideElement["crop"];
  expected: SlideElement["crop"];
}[];
it.each(cases)("$name 保持横纵缩放一致", ({ image, frame, crop, expected }) => {
  const result = coverCrop(...image, ...frame, crop);
  for (const side of ["left", "right", "top", "bottom"] as const) {
    expect(result[side]).toBeCloseTo(expected[side], 10);
    expect(result[side]).toBeGreaterThanOrEqual(crop[side] - 1e-12);
  }
  expect(frame[0] / (image[0] * (1 - result.left - result.right))).toBeCloseTo(
    frame[1] / (image[1] * (1 - result.top - result.bottom)),
    10,
  );
  expect(coverCrop(...image, frame[0] * 0.5, frame[1] * 0.5, crop)).toEqual(
    result,
  );
});
it("加载前隐藏图片，更换素材后丢弃旧尺寸，文件库完整等比预览", async () => {
  const element = newElement("image", {
    asset_id: "one",
    width: 200,
    height: 200,
  });
  const { container, rerender } = render(<ElementImage element={element} />);
  let img = container.querySelector("img")!;
  expect(img.style.visibility).toBe("hidden");
  Object.defineProperties(img, {
    naturalWidth: { value: 400 },
    naturalHeight: { value: 200 },
  });
  fireEvent.load(img);
  expect(img.style.visibility).toBe("visible");
  expect(img.style.width).toBe("200%");
  expect(img.style.height).toBe("100%");
  await act(async () => {
    blobState.url = "blob:two";
  });
  rerender(<ElementImage element={{ ...element, asset_id: "two" }} />);
  img = container.querySelector("img")!;
  expect(img.style.visibility).toBe("hidden");
  Object.defineProperties(img, {
    naturalWidth: { value: 200 },
    naturalHeight: { value: 400 },
  });
  fireEvent.load(img);
  expect(img.style.width).toBe("100%");
  expect(img.style.height).toBe("200%");
  rerender(<ElementImage element={element} contain />);
  expect(img.style.objectFit).toBe("contain");
  expect(img.style.width).toBe("100%");
  expect(img.style.height).toBe("100%");
});
