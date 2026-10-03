import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useVirtualMotion } from "../src/features/desktop-pet/locomotion/useVirtualMotion";
import type { MotionDemo } from "../src/features/desktop-pet/locomotion/demo";

afterEach(() => vi.useRealTimers());

test("virtual climb and glide use local boundaries and real travelled phase without moving the desktop", async () => {
  vi.useFakeTimers();
  const hook = renderHook(({ demo, key }) => useVirtualMotion(demo, key, 220), {
    initialProps: { demo: null as MotionDemo | null, key: 0 },
  });
  const stage = document.createElement("div");
  Object.defineProperties(stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 450 },
  });
  hook.result.current.stage.current = stage;
  hook.rerender({ demo: "climb-left", key: 1 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  const start = hook.result.current.placement!;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  const climbed = hook.result.current.placement!;
  expect(climbed.left).toBe(4);
  expect(climbed.top).toBeLessThan(start.top - 35);
  expect(climbed.frame.phase - start.frame.phase).toBeCloseTo(
    ((start.top - climbed.top) / (220 * 0.22)) * Math.PI * 2,
    3,
  );
  hook.rerender({ demo: "glide-right", key: 2 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  const gliding = hook.result.current.placement!;
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(hook.result.current.placement!.left).toBeGreaterThan(gliding.left);
  expect(hook.result.current.placement!.top).toBeGreaterThan(gliding.top);
  hook.rerender({ demo: "climb-right", key: 3 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.placement!.left).toBe(431);
  expect(hook.result.current.placement!.frame.edge).toBe("right");
  hook.rerender({ demo: null, key: 4 });
  expect(hook.result.current.placement).toBeNull();
});
