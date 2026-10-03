import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import type {
  PetEnvironment,
  PetMotionRequest,
} from "../src/platform/petMotion";
import { usePetLocomotion } from "../src/features/desktop-pet/locomotion/usePetLocomotion";

const settings = {
  roam: "free" as const,
  size: 220,
  edgeClimbing: true,
  highGliding: true,
};
const body = {
  visible: { x: 80, y: 130, width: 140, height: 220 },
  feet: { x: 150, y: 350 },
};
const original = window.futurePropsDesktop;
let env: PetEnvironment;
let changed: ((value: PetEnvironment) => void) | undefined;
const move = vi.fn(),
  cancel = vi.fn(),
  event = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.9);
  env = {
    revision: 1,
    generation: 0,
    bounds: { x: 400, y: 420, width: 300, height: 400 },
    workArea: { x: 0, y: 25, width: 1280, height: 775 },
    displayId: 1,
    visible: true,
  };
  move.mockReset().mockImplementation(async (value: PetMotionRequest) => {
    env = {
      ...env,
      bounds: { ...env.bounds, x: Math.round(value.x), y: Math.round(value.y) },
    };
    return env;
  });
  cancel.mockReset().mockImplementation(async (generation: number) => {
    env = { ...env, generation };
    return env;
  });
  event.mockClear();
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      petEnvironment: async () => env,
      movePetFrame: move,
      cancelPetMotion: cancel,
      onPetEnvironment: (callback: typeof changed) => {
        changed = callback;
        return () => {
          changed = undefined;
        };
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: original,
  });
});
async function mount() {
  const hook = renderHook(
    ({ blocked }) =>
      usePetLocomotion({
        enabled: true,
        settings,
        blocked,
        geometry: () => body,
        onEvent: event,
      }),
    { initialProps: { blocked: false } },
  );
  await act(async () => {});
  return hook;
}
test("continuous requests contain authorized geometry and strides follow actual host positions", async () => {
  const { result, unmount } = await mount();
  await act(() => vi.advanceTimersByTimeAsync(7100));
  expect(move).toHaveBeenCalled();
  expect(result.current.frame.state).toBe("walk");
  expect(event).toHaveBeenCalledWith("roam");
  const request = move.mock.lastCall![0];
  expect(request.geometry).toEqual(body);
  expect(request.environmentRevision).toBe(1);
  expect(request.manual).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(result.current.frame.phase).toBeGreaterThan(0);
  unmount();
  expect(cancel).toHaveBeenCalled();
});
test("one in-flight request, pause cancels its generation, and a late receipt cannot revive movement", async () => {
  let finish!: (value: PetEnvironment) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = await mount();
  await act(() => vi.advanceTimersByTimeAsync(7500));
  expect(move).toHaveBeenCalledTimes(1);
  const owner = move.mock.calls[0][0].generation;
  rerender({ blocked: true });
  await act(async () => {});
  expect(cancel.mock.lastCall![0]).toBeGreaterThan(owner);
  await act(async () => finish({ ...env, bounds: { ...env.bounds, x: 999 } }));
  expect(result.current.environment?.bounds.x).toBe(400);
  expect(result.current.frame.state).toBe("idle");
  rerender({ blocked: false });
  await act(() => vi.advanceTimersByTimeAsync(6900));
  expect(move).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(move.mock.calls.length).toBeGreaterThan(1);
});
test("stationary press is held, release stays at the host-confirmed position, and hide/restore resets rest", async () => {
  const { result } = await mount();
  act(() => result.current.press(200, 200));
  await act(() => vi.advanceTimersByTimeAsync(190));
  expect(result.current.frame.state).toBe("held");
  act(() => result.current.pointer(230, 100));
  await act(() => vi.advanceTimersByTimeAsync(100));
  const placed = result.current.environment!.bounds;
  act(() => result.current.release());
  await act(async () => {});
  expect(result.current.environment?.bounds).toEqual(placed);
  expect(result.current.frame.state).toBe("idle");
  env = { ...env, visible: false };
  act(() => changed?.(env));
  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(result.current.frame.state).toBe("idle");
  env = { ...env, visible: true, revision: 2 };
  await act(async () => changed?.(env));
  await act(() => vi.advanceTimersByTimeAsync(6900));
  expect(result.current.frame.state).toBe("idle");
});

test("communication failure halts at a confirmed position until a new host environment arrives", async () => {
  move.mockRejectedValueOnce(new Error("disconnected"));
  const { result } = await mount();
  await act(() => vi.advanceTimersByTimeAsync(7400));
  expect(result.current.error).toContain("走动失败");
  expect(result.current.environment?.bounds.x).toBe(400);
  expect(result.current.frame.state).toBe("idle");
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () => changed?.(env));
  await act(() => vi.advanceTimersByTimeAsync(7400));
  expect(move.mock.calls.length).toBeGreaterThan(1);
});

test("a delayed drag receipt cannot drop the latest pointer target and release flushes it once", async () => {
  let finish!: (value: PetEnvironment) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await mount();
  act(() => {
    result.current.press(200, 200);
    result.current.pointer(210, 200);
  });
  await act(() => vi.advanceTimersByTimeAsync(50));
  expect(move).toHaveBeenCalledTimes(1);
  act(() => result.current.pointer(270, 150));
  act(() => result.current.release());
  await act(async () => {});
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...env, bounds: { ...env.bounds, x: 410 } }));
  expect(move).toHaveBeenCalledTimes(2);
  const final = move.mock.lastCall![0];
  expect(final.x).toBe(470);
  expect(final.y).toBe(370);
  expect(final.manual).toBe(true);
  expect(result.current.environment?.bounds.x).toBe(470);
  expect(result.current.frame.state).toBe("idle");
});
