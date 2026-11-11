import { expect, it, vi } from "vitest";
import {
  advancePlayback,
  startPlaybackClock,
} from "@features/director-desk/editor/editor/playback-clock";

it("wraps looped playback, stops at the end and cancels the next frame on disposal", () => {
  expect(advancePlayback(0.95, true, true, 1, 0.1).time).toBeCloseTo(0.05);
  expect(advancePlayback(0.95, true, false, 1, 0.1)).toEqual({
    time: 1,
    playing: false,
  });
  let frame!: FrameRequestCallback;
  let handle = 0;
  const request = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frame = callback;
      return ++handle;
    });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {});
  try {
    const lifecycle = new AbortController();
    const update = vi.fn();
    startPlaybackClock(lifecycle.signal, update);
    frame(performance.now() + 1_000);
    expect(update).toHaveBeenCalledWith(0.1, expect.any(Function));
    lifecycle.abort();
    expect(cancel).toHaveBeenCalledWith(2);
  } finally {
    request.mockRestore();
    cancel.mockRestore();
  }
});
