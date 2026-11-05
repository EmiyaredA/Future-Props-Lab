import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LoadingState } from "@shared/ui/LoadingState";

let reduced = false;
let hidden = false;
let preferenceChanged: (() => void) | undefined;
let removePreferenceListener = vi.fn();

beforeEach(() => {
  reduced = false;
  hidden = false;
  preferenceChanged = undefined;
  removePreferenceListener = vi.fn();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    get matches() {
      return reduced;
    },
    media: query,
    onchange: null,
    addEventListener: (
      _name: string,
      callback: EventListenerOrEventListenerObject,
    ) => {
      preferenceChanged = callback as () => void;
    },
    removeEventListener: removePreferenceListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each(["page", "region"] as const)(
  "%s loading delays animation and keeps a static poster until playback starts",
  (variant) => {
    vi.useFakeTimers();
    const { container } = render(<LoadingState variant={variant} />);
    expect(container.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(container.querySelector("img, video, source")).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelector("source")).toHaveAttribute(
      "srcset",
      "/brand/loading/kurisu-run.webp",
    );
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/brand/loading/kurisu-run.webm");
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.parentElement).toHaveAttribute("data-playing", "false");
    fireEvent.playing(video);
    expect(video.parentElement).toHaveAttribute("data-playing", "true");
    expect(video.parentElement).toHaveAttribute("aria-hidden", "true");
    fireEvent.waiting(video);
    expect(video.parentElement).toHaveAttribute("data-playing", "false");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
  },
);

test("inline actions use the compact running character without prop assets", () => {
  const { container } = render(
    <LoadingState variant="inline" label="保存中…" delay={0} />,
  );
  expect(
    container.querySelector(".fpl-loading-scene--inline"),
  ).toBeInTheDocument();
  expect(container.querySelector("video")).toBeInTheDocument();
  expect(container.querySelector(".fpl-scene-prop")).toBeNull();
  expect(screen.getByText("保存中…")).toBeInTheDocument();
});

test("reduced motion uses only the poster and responds to preference changes", () => {
  reduced = true;
  const { container, unmount } = render(<LoadingState delay={0} />);
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/brand/loading/kurisu-run.png",
  );
  act(() => {
    reduced = false;
    preferenceChanged?.();
  });
  fireEvent.playing(container.querySelector("video")!);
  act(() => {
    reduced = true;
    preferenceChanged?.();
  });
  expect(container.querySelector("video")).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  act(() => {
    reduced = false;
    preferenceChanged?.();
  });
  expect(container.querySelector(".fpl-loading-character")).toHaveAttribute(
    "data-playing",
    "false",
  );
  unmount();
  expect(removePreferenceListener).toHaveBeenCalled();
});

test.each(["decode", "autoplay"])(
  "%s failure preserves the poster, label, and real progress",
  async (failure) => {
    if (failure === "autoplay")
      vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
        new DOMException("Autoplay blocked", "NotAllowedError"),
      );
    const { container } = render(
      <LoadingState
        delay={0}
        label="正在读取预览…"
        progress={{
          direction: "download",
          phase: "transferring",
          loaded: 1,
          total: 4,
          bytesPerSecond: 0,
        }}
      />,
    );
    if (failure === "decode")
      fireEvent.error(container.querySelector("video")!);
    await waitFor(() => expect(container.querySelector("video")).toBeNull());
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.getByText("正在读取预览…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
  },
);

test("playback requests data before a decoded frame, pauses when hidden and cleans up", () => {
  vi.mocked(
    Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState")!
      .get!,
  ).mockReturnValue(0);
  const { container, unmount } = render(<LoadingState delay={0} />);
  const video = container.querySelector("video")!;
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  vi.mocked(
    Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState")!
      .get!,
  ).mockReturnValue(2);
  fireEvent.loadedData(video);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  act(() => {
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  unmount();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  document.dispatchEvent(new Event("visibilitychange"));
  fireEvent.loadedData(video);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
});

test("an interrupted or stale play promise does not turn a new load into a failure", async () => {
  let rejectPlay!: (error: DOMException) => void;
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectPlay = reject;
      }),
  );
  const { container, rerender } = render(<LoadingState delay={0} />);
  rerender(<LoadingState delay={0} variant="inline" />);
  await act(async () =>
    rejectPlay(new DOMException("Interrupted", "AbortError")),
  );
  rerender(<LoadingState delay={0} />);
  expect(container.querySelector("video")).toBeInTheDocument();
});
