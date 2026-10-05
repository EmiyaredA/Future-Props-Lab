import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePetLocomotion } from "@features/desktop-pet/locomotion/usePetLocomotion";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type { FrameSequences } from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";
import type { PetEnvironment, PetMotionRequest } from "@platform/petMotion";

const originalBridge = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = originalBridge;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const shape = {
  visible: { x: 20, y: 10, width: 180, height: 230 },
  feet: { x: 110, y: 250 },
};
function setup(
  feedback: (() => string | null) | undefined,
  roam: "free" | "calm" = "free",
) {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.8);
  let environment: PetEnvironment = {
    revision: 1,
    generation: 0,
    displayId: 1,
    visible: true,
    bounds: { x: 300, y: 550, width: 250, height: 250 },
    workArea: { x: 0, y: 0, width: 1000, height: 800 },
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
  const hook = renderHook(
    ({
      feedback,
      revision,
    }: {
      feedback?: () => string | null;
      revision: number;
    }) =>
      usePetLocomotion({
        enabled: true,
        blocked: false,
        settings: { roam, size: 220, edgeClimbing: false, highGliding: false },
        geometry: () => shape,
        ...(feedback ? { motionFailure: feedback } : {}),
        resourceRevision: revision,
        onEvent: vi.fn(),
      }),
    { initialProps: { ...(feedback ? { feedback } : {}), revision: 1 } },
  );
  const tick = async (ms = 100) => act(() => vi.advanceTimersByTimeAsync(ms));
  return { hook, move, cancel, tick };
}
const pack: FrameSequences = {
  version: 1,
  frameSize: [100, 200],
  modelBox: [0, 0, 100, 200],
  headLength: 40,
  clips: {
    idle: {
      loop: true,
      frames: [
        {
          texture: "whole",
          rect: [0, 0, 100, 200],
          durationMs: 400,
          grip: [50, 100],
          foot: [50, 190],
          head: [
            [50, 10],
            [50, 50],
          ],
        },
      ],
    },
  },
  transitions: [],
};
const idle = (t: number): WhaleFrame => ({
  t,
  mode: "idle",
  look: [0, 0],
  legs: [],
  swing: 0,
  sit: 0,
});
function sequenceStage() {
  let broken = true;
  let resolve!: () => void;
  const barrier = new Promise<void>((yes) => {
    resolve = yes;
  });
  class Image {
    src = "";
    naturalWidth = 100;
    naturalHeight = 200;
    async decode() {
      if (broken) throw new Error("actual-atlas-decode-failed");
      await barrier;
    }
  }
  vi.stubGlobal("Image", Image);
  const drawImage = vi.fn();
  const context = {
    drawImage,
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => context) as unknown as HTMLCanvasElement["getContext"],
  );
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    scheme: "classic",
    motionFacing: () => 1,
    draw: vi.fn(),
    setScheme: vi.fn(),
    reset: vi.fn(),
    preload: async () => undefined,
  };
  const figure = createSequenceFigure({
    base,
    sequences: pack,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => path,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  return {
    figure,
    drawImage,
    allowDecode: () => {
      broken = false;
    },
    resolve,
    paint: (t: number) => figure.draw(group, { eyes: [], gap: [] }, idle(t)),
  };
}

test("actual SequenceFigure retry retains fatal feedback during decode and clears hook only after painted commit", async () => {
  const stage = sequenceStage();
  await stage.figure.preload();
  expect(stage.figure.getMotionFailure!()).toBe("actual-atlas-decode-failed");
  const read = vi.fn(() => stage.figure.getMotionFailure!());
  const f = setup(read);
  await f.tick();
  expect(f.hook.result.current.issue).toMatchObject({
    kind: "pose-invalid",
    severity: "error",
    code: "actual-atlas-decode-failed",
  });
  const cancellations = f.cancel.mock.calls.length;
  await f.tick(20_000);
  expect(f.cancel).toHaveBeenCalledTimes(cancellations);
  expect(f.move).not.toHaveBeenCalled();
  stage.allowDecode();
  stage.figure.retryAssetLoad?.();
  const pending = stage.figure.preload();
  await f.tick(500);
  expect(f.hook.result.current.error).not.toBe("");
  expect(stage.drawImage).not.toHaveBeenCalled();
  f.hook.rerender({ feedback: read, revision: 2 });
  await f.tick(500);
  expect(f.hook.result.current.issue).toMatchObject({
    code: "actual-atlas-decode-failed",
    severity: "error",
  });
  expect(f.move).not.toHaveBeenCalled();
  const retryCancellations = f.cancel.mock.calls.length;
  await f.tick(500);
  expect(f.cancel).toHaveBeenCalledTimes(retryCancellations);
  stage.resolve();
  await pending;
  // Decoded pixels alone are not a successful replacement picture.
  await f.tick(100);
  expect(f.hook.result.current.error).not.toBe("");
  expect(f.cancel).toHaveBeenCalledTimes(retryCancellations);
  stage.paint(0);
  expect(stage.drawImage).toHaveBeenCalledTimes(1);
  expect(stage.figure.getMotionFailure!()).toBeNull();
  await f.tick(50);
  expect(f.hook.result.current.issue).toBeNull();
  expect(f.hook.result.current.error).toBe("");
  expect(f.hook.result.current.frame.state).toBe("idle");
  expect(f.move).not.toHaveBeenCalled();
  await f.tick(6_500);
  expect(f.move).not.toHaveBeenCalled();
  await f.tick(1_000);
  expect(f.move).toHaveBeenCalled();
  f.hook.unmount();
  stage.figure.dispose?.();
});

test.each(["free", "calm"] as const)(
  "confirmed recovery waits a fresh %s rest interval instead of resuming the failed trajectory",
  async (roam) => {
    let failure: string | null = null;
    const f = setup(() => failure, roam);
    await f.tick(roam === "free" ? 8_000 : 18_000);
    expect(f.move).toHaveBeenCalled();
    failure = "sequence:support-registration-mismatch";
    await f.tick();
    expect(f.hook.result.current.issue?.severity).toBe("error");
    const count = f.move.mock.calls.length;
    await f.tick(20_000);
    expect(f.move).toHaveBeenCalledTimes(count);
    failure = null;
    await f.tick(40);
    expect(f.hook.result.current.issue).toBeNull();
    expect(f.hook.result.current.frame.state).toBe("idle");
    await f.tick(roam === "free" ? 6_500 : 16_500);
    expect(f.move).toHaveBeenCalledTimes(count);
    await f.tick(1_000);
    expect(f.move.mock.calls.length).toBeGreaterThan(count);
    f.hook.unmount();
  },
);

test("changed fatal code updates one cancellation; current missing-art warning replaces stale fatal feedback", async () => {
  let failure: string | null = "sequence:missing-support";
  const f = setup(() => failure);
  await f.tick();
  const first = f.cancel.mock.calls.length;
  failure = "sequence:support-conflict";
  await f.tick();
  expect(f.hook.result.current.issue).toMatchObject({
    code: failure,
    severity: "error",
  });
  expect(f.hook.result.current.error).toContain("支撑点相互冲突");
  expect(f.cancel).toHaveBeenCalledTimes(first + 1);
  await f.tick(1_000);
  expect(f.cancel).toHaveBeenCalledTimes(first + 1);
  failure = "sequence:missing-clip";
  await f.tick();
  expect(f.hook.result.current.issue).toMatchObject({
    kind: "resource-unavailable",
    code: failure,
    severity: "warning",
  });
  expect(f.hook.result.current.error).toBe("");
  const count = f.cancel.mock.calls.length;
  await f.tick(8_000);
  expect(f.cancel).toHaveBeenCalledTimes(count);
  expect(f.move).not.toHaveBeenCalled();
  f.hook.unmount();
});

test("removing the feedback callback is not a successful picture and cannot clear a fatal issue", async () => {
  const feedback = () => "sequence:missing-support";
  const f = setup(feedback);
  await f.tick();
  const count = f.cancel.mock.calls.length;
  f.hook.rerender({ revision: 1 });
  await f.tick(10_000);
  expect(f.hook.result.current.issue).toMatchObject({
    code: "sequence:missing-support",
    severity: "error",
  });
  expect(f.cancel).toHaveBeenCalledTimes(count);
  expect(f.move).not.toHaveBeenCalled();
  f.hook.rerender({ feedback: () => "", revision: 1 });
  await f.tick(10_000);
  expect(f.hook.result.current.issue).toMatchObject({
    code: "sequence:missing-support",
    severity: "error",
  });
  expect(f.cancel).toHaveBeenCalledTimes(count);
  expect(f.move).not.toHaveBeenCalled();
  f.hook.unmount();
});

test("null renderer feedback cannot clear transport failure; explicit regrab can recover manual input", async () => {
  const f = setup(() => null);
  f.move.mockRejectedValueOnce(new Error("actual movement RPC failed"));
  await f.tick(7_500);
  expect(f.hook.result.current.issue).toMatchObject({
    kind: "transport",
    code: "move-failed",
    severity: "error",
  });
  const count = f.move.mock.calls.length;
  await f.tick(20_000);
  expect(f.hook.result.current.issue?.kind).toBe("transport");
  expect(f.move).toHaveBeenCalledTimes(count);
  act(() => f.hook.result.current.press(100, 120));
  await f.tick(250);
  act(() => f.hook.result.current.pointer(130, 120));
  await f.tick(100);
  expect(f.hook.result.current.issue).toBeNull();
  expect(f.move.mock.lastCall?.[0]).toMatchObject({ manual: true, x: 330 });
  act(() => f.hook.result.current.release(true));
  f.hook.unmount();
});
