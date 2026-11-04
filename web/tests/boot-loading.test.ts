import { readFileSync } from "node:fs";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startBootLoading } from "@app/bootLoading";

const html = readFileSync("index.html", "utf8");
let dispose = () => {};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function mount() {
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.body.append(doc.querySelector("#root")!);
  dispose = startBootLoading();
  return document.querySelector("video")!;
}
test("HTML boot uses the shared dial, starts after 150ms and cleans up before React", () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const video = mount();
  expect(video.hasAttribute("src")).toBe(false);
  expect(document.querySelector("img[src], source[srcset]")).toBeNull();
  expect(document.querySelector(".fpl-dial-sweep use")).toHaveAttribute(
    "href",
    "/brand/loading/loading-dial.svg#sweep",
  );
  act(() => vi.advanceTimersByTime(150));
  expect(document.querySelector("source")).toHaveAttribute(
    "srcset",
    "/brand/loading/kurisu-run.webp",
  );
  expect(video).toHaveAttribute("src", "/brand/loading/kurisu-run.webm");
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  video.dispatchEvent(new Event("playing"));
  expect(video.parentElement).toHaveAttribute("data-playing", "true");
  dispose();
  expect(video.hasAttribute("src")).toBe(false);
  const count = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(count);
});
test("fast boot disposal avoids all character and prop media requests", () => {
  vi.useFakeTimers();
  mount();
  dispose();
  act(() => vi.advanceTimersByTime(500));
  expect(
    document.querySelector("img[src], source[srcset], video[src]"),
  ).toBeNull();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
test("reduced-motion boot never requests the video and retains Kurisu", () => {
  vi.useFakeTimers();
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  const video = mount();
  act(() => vi.advanceTimersByTime(150));
  expect(video.hasAttribute("src")).toBe(false);
  expect(
    document.querySelector(".fpl-loading-character img"),
  ).toBeInTheDocument();
  expect(document.querySelector(".fpl-loading-scene")).toHaveAttribute(
    "data-paused",
    "true",
  );
});
