import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

test.each([
  ["page", 8],
  ["region", 8],
  ["inline", 0],
] as const)(
  "%s uses the same running scene with %s props and no extra announcements",
  (variant, count) => {
    const { container } = render(<LoadingState variant={variant} delay={0} />);
    expect(container.querySelectorAll(".fpl-loading-character")).toHaveLength(
      1,
    );
    expect(container.querySelectorAll(".fpl-scene-prop")).toHaveLength(count);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector(".fpl-loading-scene")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector(".fpl-dial-sweep use")).toHaveAttribute(
      "href",
      "/brand/loading/loading-dial.svg#sweep",
    );
  },
);

test("preview pause preserves the video instance and pauses the entire scene", () => {
  const play = vi.mocked(HTMLMediaElement.prototype.play);
  const pause = vi.mocked(HTMLMediaElement.prototype.pause);
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
  const { container, rerender } = render(<LoadingScene variant="page" />);
  const video = container.querySelector("video");
  rerender(<LoadingScene variant="page" paused />);
  expect(container.querySelector("video")).toBe(video);
  expect(pause).toHaveBeenCalled();
  expect(container.firstChild).toHaveAttribute("data-paused", "true");
  const calls = play.mock.calls.length;
  rerender(<LoadingScene variant="page" />);
  expect(container.querySelector("video")).toBe(video);
  expect(play.mock.calls.length).toBeGreaterThan(calls);
  vi.restoreAllMocks();
});

test("hidden scenes suspend CSS effects and remove visibility listeners on unmount", () => {
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const { container, unmount } = render(<LoadingScene />);
  expect(container.firstChild).toHaveAttribute("data-paused", "false");
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(container.firstChild).toHaveAttribute("data-paused", "true");
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(container.firstChild).toHaveAttribute("data-paused", "false");
  const remove = vi.spyOn(document, "removeEventListener");
  unmount();
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  vi.restoreAllMocks();
});

test("static and failed playback retain Kurisu, dial and props", () => {
  const { container, rerender } = render(
    <LoadingScene variant="page" active={false} />,
  );
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelectorAll(".fpl-scene-prop")).toHaveLength(8);
  rerender(<LoadingScene variant="page" />);
  fireEvent.error(container.querySelector("video")!);
  expect(container.querySelector("video")).toBeNull();
  expect(
    container.querySelector(".fpl-loading-character img"),
  ).toBeInTheDocument();
  expect(container.querySelector(".fpl-loading-dial")).toBeInTheDocument();
  expect(container.querySelectorAll(".fpl-scene-prop")).toHaveLength(8);
});

test("offscreen loading scenes pause without replacing the character", () => {
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const { container, unmount } = render(<LoadingScene />);
  const video = container.querySelector("video");
  expect(container.firstChild).toHaveAttribute("data-paused", "true");
  act(() =>
    notify(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(container.firstChild).toHaveAttribute("data-paused", "false");
  act(() =>
    notify(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(container.firstChild).toHaveAttribute("data-paused", "true");
  expect(container.querySelector("video")).toBe(video);
  unmount();
  expect(disconnect).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
