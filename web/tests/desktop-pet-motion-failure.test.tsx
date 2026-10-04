import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePetLocomotion } from "../src/features/desktop-pet/locomotion/usePetLocomotion";
import type {
  PetEnvironment,
  PetMotionRequest,
} from "../src/platform/petMotion";

const originalBridge = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = originalBridge;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.8);
  let reason: string | null = null;
  let environment: PetEnvironment = {
    revision: 1,
    generation: 0,
    bounds: { x: 300, y: 550, width: 250, height: 250 },
    workArea: { x: 0, y: 0, width: 1000, height: 800 },
    displayId: 1,
    visible: true,
  };
  const move = vi.fn(async (request: PetMotionRequest) => {
    environment = {
      ...environment,
      revision: environment.revision + 1,
      generation: request.generation,
      bounds: { ...environment.bounds, x: request.x, y: request.y },
    };
    return environment;
  });
  const cancel = vi.fn(async (generation: number) => {
    environment = { ...environment, generation };
    return environment;
  });
  window.futurePropsDesktop = {
    petEnvironment: async () => environment,
    movePetFrame: move,
    cancelPetMotion: cancel,
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(() =>
    usePetLocomotion({
      enabled: true,
      settings: {
        roam: "free",
        size: 220,
        edgeClimbing: true,
        highGliding: true,
      },
      blocked: false,
      geometry: () => ({
        visible: { x: 20, y: 10, width: 180, height: 230 },
        feet: { x: 110, y: 250 },
      }),
      motionFailure: () => reason,
      onEvent: vi.fn(),
    }),
  );
  return {
    hook,
    move,
    cancel,
    fail: (value: string | null) => (reason = value),
  };
}

test("renderer support failure cancels movement and does not retry a rejected trajectory", async () => {
  const f = fixture();
  await act(() => vi.advanceTimersByTimeAsync(8500));
  expect(f.move).toHaveBeenCalled();
  const requests = f.move.mock.calls.length;
  f.fail("planned-pose-unreachable");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(f.cancel).toHaveBeenCalled();
  expect(f.hook.result.current.error).toContain("无法保持支撑");
  expect(f.hook.result.current.frame.state).toBe("idle");
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(f.move.mock.calls).toHaveLength(requests);
  f.hook.unmount();
});

test("missing transition has a distinct reason and manual regrab remains available", async () => {
  const f = fixture();
  f.fail("needs-walk-turn-view");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(f.hook.result.current.error).toContain("缺少连续过渡姿势");
  expect(f.move).not.toHaveBeenCalled();
  f.fail(null);
  act(() => f.hook.result.current.press(100, 120));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(f.hook.result.current.error).toBe("");
  expect(f.hook.result.current.frame.state).toBe("held");
  act(() => f.hook.result.current.release(true));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(f.hook.result.current.frame.state).toBe("idle");
  f.hook.unmount();
});
