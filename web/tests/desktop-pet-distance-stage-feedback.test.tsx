import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useVirtualMotion } from "@features/desktop-pet/locomotion/useVirtualMotion";
import { usePetLocomotion } from "@features/desktop-pet/locomotion/usePetLocomotion";
import type { MotionDemo } from "@features/desktop-pet/locomotion/demo";
import type {
  PetEnvironment,
  PetPosePlayback,
  PetMotionRequest,
} from "@platform/petMotion";
const saved = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = saved;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const status = (
  progress: number,
  remaining: number,
  travel = { x: 0, y: 0 },
): PetPosePlayback => ({
  id: "stage",
  progress,
  motionBudget: {
    epoch: "stage",
    remainingDIP: remaining,
    confirmedTravel: { ...travel },
  },
});
test("virtual confirmed placement caps a push then waits without catchup or menu reset", async () => {
  vi.useFakeTimers();
  let feedback: PetPosePlayback | null = null;
  const cancel = vi.fn(() => {
    feedback = null;
  });
  const hook = renderHook(
    ({ demo, key }) =>
      useVirtualMotion(
        demo,
        key,
        220,
        () => 20,
        () => ({ transition: feedback, failure: null }),
        cancel,
      ),
    { initialProps: { demo: null as MotionDemo | null, key: 0 } },
  );
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientWidth: { value: 600 },
    clientHeight: { value: 450 },
  });
  hook.result.current.stage.current = element;
  hook.rerender({ demo: "climb-right", key: 1 });
  await act(() => vi.advanceTimersByTimeAsync(16));
  const first = hook.result.current.placement!;
  feedback = status(1, 2, first.frame.travel!);
  await act(() => vi.advanceTimersByTimeAsync(500));
  const endpoint = hook.result.current.placement!;
  expect(first.top - endpoint.top).toBeCloseTo(2);
  expect(endpoint.frame.phase - first.frame.phase).toBeCloseTo(
    (2 / 20) * Math.PI * 2,
  );
  feedback = status(0.2, 0, endpoint.frame.travel!);
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(hook.result.current.placement).toEqual(endpoint);
  const cancels = cancel.mock.calls.length;
  hook.rerender({ demo: "climb-right", key: 1 });
  expect(cancel).toHaveBeenCalledTimes(cancels);
  feedback = status(1, 2, endpoint.frame.travel!);
  await act(() => vi.advanceTimersByTimeAsync(16));
  const resumed = hook.result.current.placement!;
  expect(endpoint.top - resumed.top).toBeGreaterThan(0);
  expect(endpoint.top - resumed.top).toBeLessThan(1);
  hook.rerender({ demo: "climb-right", key: 2 });
  expect(cancel).toHaveBeenCalledTimes(cancels + 1);
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(hook.result.current.placement!.top).toBe(resumed.top);
  hook.unmount();
});

test("real desktop hook never submits beyond the total budget while a receipt is pending", async () => {
  vi.useFakeTimers();
  let env: PetEnvironment = {
    generation: 0,
    revision: 1,
    displayId: 1,
    visible: true,
    bounds: { x: -400, y: 400, width: 300, height: 300 },
    workArea: { x: -2000, y: -1000, width: 6000, height: 3000 },
  };
  let feedback: PetPosePlayback | null = null;
  let resolve: ((value: PetEnvironment) => void) | null = null;
  const move = vi.fn(
    (request: PetMotionRequest) =>
      new Promise<PetEnvironment>((done) => {
        resolve = (value) => {
          env = { ...value, generation: request.generation };
          done(env);
        };
      }),
  );
  window.futurePropsDesktop = {
    petEnvironment: async () => env,
    movePetFrame: move,
    cancelPetMotion: async (generation: number) =>
      (env = { ...env, generation }),
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(() =>
    usePetLocomotion({
      enabled: true,
      settings: {
        roam: "free",
        size: 220,
        edgeClimbing: false,
        highGliding: false,
      },
      blocked: false,
      geometry: () => ({
        visible: { x: 0, y: 0, width: 100, height: 100 },
        feet: { x: 50, y: 100 },
        strideLength: 8,
      }),
      motionTransition: () => feedback,
      motionFailure: () => null,
      cancelPlayback: () => {
        feedback = null;
      },
      onEvent: () => {
        feedback = status(0, 0);
      },
    }),
  );
  await act(() => vi.advanceTimersByTimeAsync(7400));
  expect(move).not.toHaveBeenCalled();
  feedback = status(1, 2);
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(move).toHaveBeenCalledTimes(1);
  const first = move.mock.calls[0][0];
  expect(Math.abs(first.x + 400)).toBeLessThanOrEqual(2);
  await act(async () => {
    resolve!({
      ...env,
      revision: 2,
      bounds: { ...env.bounds, x: -400 + Math.sign(first.x + 400) * 0.2 },
    });
    await Promise.resolve();
  });
  for (let i = 0; i < 12 && Math.abs(env.bounds.x + 400) < 2 - 1e-8; i++) {
    const count = move.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(move).toHaveBeenCalledTimes(count + 1);
    const request = move.mock.calls.at(-1)![0];
    expect(Math.abs(request.x + 400)).toBeLessThanOrEqual(2);
    await act(async () => {
      resolve!({
        ...env,
        revision: env.revision + 1,
        bounds: { ...env.bounds, x: request.x },
      });
      await Promise.resolve();
    });
  }
  expect(Math.abs(env.bounds.x + 400)).toBeCloseTo(2);
  const calls = move.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(move).toHaveBeenCalledTimes(calls);
  expect(hook.result.current.frame.phase).toBeCloseTo((2 / 8) * Math.PI * 2);
  act(() => hook.result.current.release(true));
  hook.unmount();
});

test("pause cancels the stage epoch and ignores an old receipt; resume starts a fresh rest interval", async () => {
  vi.useFakeTimers();
  let env: PetEnvironment = {
    generation: 0,
    revision: 1,
    displayId: 1,
    visible: true,
    bounds: { x: -400, y: 400, width: 300, height: 300 },
    workArea: { x: -2000, y: -1000, width: 6000, height: 3000 },
  };
  let feedback: PetPosePlayback | null = null;
  let finish: ((value: PetEnvironment) => void) | null = null;
  const move = vi.fn(
    () =>
      new Promise<PetEnvironment>((resolve) => {
        finish = resolve;
      }),
  );
  const cancelPlayback = vi.fn(() => {
    feedback = null;
  });
  window.futurePropsDesktop = {
    petEnvironment: async () => env,
    movePetFrame: move,
    cancelPetMotion: async (generation: number) =>
      (env = { ...env, generation }),
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(
    ({ blocked }) =>
      usePetLocomotion({
        enabled: true,
        blocked,
        settings: {
          roam: "free",
          size: 220,
          edgeClimbing: false,
          highGliding: false,
        },
        geometry: () => ({
          visible: { x: 0, y: 0, width: 100, height: 100 },
          feet: { x: 50, y: 100 },
          strideLength: 8,
        }),
        motionTransition: () => feedback,
        motionFailure: () => null,
        cancelPlayback,
        onEvent: () => {
          feedback = status(0, 0);
        },
      }),
    { initialProps: { blocked: false } },
  );
  await act(() => vi.advanceTimersByTimeAsync(7400));
  feedback = status(1, 2);
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(move).toHaveBeenCalledTimes(1);
  const before = hook.result.current.environment;
  hook.rerender({ blocked: true });
  await act(() => vi.advanceTimersByTimeAsync(50));
  expect(cancelPlayback).toHaveBeenCalledTimes(1);
  expect(feedback).toBeNull();
  await act(async () => {
    finish!({ ...env, generation: 0, bounds: { ...env.bounds, x: 99 } });
    await Promise.resolve();
  });
  expect(hook.result.current.environment?.bounds).toEqual(before?.bounds);
  hook.rerender({ blocked: false });
  await act(() => vi.advanceTimersByTimeAsync(6900));
  expect(cancelPlayback).toHaveBeenCalledTimes(2);
  expect(move).toHaveBeenCalledTimes(1);
  expect(hook.result.current.frame.state).toBe("idle");
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(hook.result.current.frame.state).toBe("walk");
  expect(move).toHaveBeenCalledTimes(1);
  hook.unmount();
});
