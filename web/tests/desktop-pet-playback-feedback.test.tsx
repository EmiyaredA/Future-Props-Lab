import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  AuthoredPoseAnimation,
  type AuthoredPose,
  type PoseName,
  type PoseSample,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import { createRig } from "../src/features/desktop-pet/whale-vendor/rig/rig.js";
import { jointDeformers } from "../src/features/desktop-pet/locomotion/articulation";
import {
  PetLocomotion,
  type ActivitySettings,
} from "../src/features/desktop-pet/locomotion/controller";
import { useVirtualMotion } from "../src/features/desktop-pet/locomotion/useVirtualMotion";
import { usePetLocomotion } from "../src/features/desktop-pet/locomotion/usePetLocomotion";
import type { MotionDemo } from "../src/features/desktop-pet/locomotion/demo";
import type {
  ArticulationFrame,
  LimbName,
  MotionRig,
} from "../src/features/desktop-pet/locomotion/articulation";
import type { PoseTransition } from "../src/features/desktop-pet/locomotion/motionTransitions";
import type {
  PetEnvironment,
  PetGeometry,
  PetPosePlayback,
  PetMotionRequest,
} from "../src/platform/petMotion";
import { naturalWalkRegistration } from "./fixtures/natural-walk-registration";
import calibrated from "./fixtures/desktop-pet-calibrated-walk.json";

const names: PoseName[] = ["walk", "held", "side", "top", "bottom", "glide"];
const limbs: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
const shape: PetGeometry = {
  visible: { x: 0, y: 0, width: 160, height: 256 },
  feet: { x: 128, y: 256 },
  supportedEdges: ["left", "right", "top", "bottom"],
};
const settings: ActivitySettings = {
  roam: "free",
  size: 220,
  edgeClimbing: false,
  highGliding: false,
};
const environment: PetEnvironment = {
  generation: 0,
  revision: 1,
  displayId: 1,
  visible: true,
  bounds: { x: 400, y: 400, width: 300, height: 300 },
  workArea: { x: 0, y: 0, width: 4000, height: 1000 },
};
function native(id: string): AuthoredPose {
  const p = naturalWalkRegistration(calibrated as AuthoredPose);
  p.part = id;
  if (p.head) p.head.part = `${id}_head`;
  for (const name of limbs)
    p.limbs[name].segments = [
      `${id}_${name}_0`,
      `${id}_${name}_1`,
      `${id}_${name}_2`,
    ];
  return p;
}
function actual(sample: PoseSample<AuthoredPose>, name: LimbName) {
  const pose = sample.pose;
  const gl = new Proxy({}, { get: () => () => ({}) });
  const rig = createRig(
    { getContext: () => gl } as unknown as HTMLCanvasElement,
    {
      view: [0, 0, 256, 300],
      parts: [],
      deformers: {
        body: { kind: "rot", pivot: pose.waist },
        ...jointDeformers({
          waist: pose.waist,
          limbs: pose.limbs,
        } as unknown as MotionRig),
      },
    },
  );
  return rig.point(`${name}End`, sample.state, ...pose.limbs[name].contact!);
}
/** Mathematical complete cels exercise the actual engine, not visual acceptance. */
function fixture(durationMs = 900) {
  const poses = Object.fromEntries(
    names.map((name) => [name, native(name)]),
  ) as Record<PoseName, AuthoredPose>;
  const stand = native("stand"),
    middle = native("middle");
  const supports = (p: AuthoredPose) => ({
    legFront: { edge: "bottom" as const, point: p.limbs.legFront.contact! },
    legBack: { edge: "bottom" as const, point: p.limbs.legBack.contact! },
  });
  const start: PoseTransition<AuthoredPose> = {
    id: "full_start",
    from: { pose: "stand", facing: 1 },
    to: { pose: "walk", facing: 1 },
    durationMs,
    keyframes: [
      { progress: 0, pose: stand, supports: supports(stand) },
      { progress: 0.5, pose: middle, supports: supports(middle) },
      { progress: 1, pose: "walk", supports: supports(poses.walk) },
    ],
  };
  const stop: PoseTransition<AuthoredPose> = {
    id: "full_stop",
    from: start.to,
    to: start.from,
    durationMs,
    keyframes: [
      { progress: 0, pose: "walk" },
      { progress: 1, pose: stand },
    ],
  };
  return {
    poses,
    middle,
    start,
    engine: new AuthoredPoseAnimation(poses, { transitions: [start, stop] }),
  };
}
function frame(t: number, pet?: PetLocomotion): ArticulationFrame {
  return {
    t,
    mode: pet?.frame.state ?? "idle",
    facing: 1,
    swing: 0,
    sit: 0,
    worldScale: 1,
    ...(pet
      ? {
          locomotion: {
            ...pet.frame,
            travel: { ...(pet.frame.travel ?? { x: 0, y: 0 }) },
          },
        }
      : {}),
  };
}
function controller(extra: Partial<ActivitySettings> = {}, x = 400) {
  const events: string[] = [];
  const pet = new PetLocomotion(
    { ...environment, bounds: { ...environment.bounds, x } },
    { ...settings, ...extra },
    (event) => events.push(event),
    () => 0.8,
  );
  const tick = (playback?: PetPosePlayback | null) => {
    const moving = pet.step(0.05, shape, playback);
    if (moving)
      pet.receipt(
        {
          ...pet.environment,
          bounds: { ...pet.environment.bounds, x: pet.x, y: pet.y },
        },
        0.05,
      );
    return moving;
  };
  return { pet, events, tick };
}
const originalBridge = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = originalBridge;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function runtime(
  engine: AuthoredPoseAnimation,
  onEvent: (name: "roam" | "grab" | "drop") => void = vi.fn(),
) {
  vi.useFakeTimers();
  let confirmed = structuredClone(environment);
  const move = vi.fn(async (request: PetMotionRequest) => {
    confirmed = {
      ...confirmed,
      generation: request.generation,
      revision: confirmed.revision + 1,
      bounds: { ...confirmed.bounds, x: request.x, y: request.y },
    };
    return confirmed;
  });
  window.futurePropsDesktop = {
    petEnvironment: async () => confirmed,
    movePetFrame: move,
    cancelPetMotion: async (generation: number) =>
      (confirmed = { ...confirmed, generation }),
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const cancel = vi.fn(() => engine.cancelMotionPlayback());
  const feedback = vi.fn(() => engine.getMotionTransition());
  const hook = renderHook(() =>
    usePetLocomotion({
      enabled: true,
      settings,
      blocked: false,
      geometry: () => shape,
      motionTransition: feedback,
      motionFailure: () => engine.getMotionFailure(),
      cancelPlayback: cancel,
      onEvent,
    }),
  );
  return { hook, move, cancel, feedback };
}

test("legacy feedback-free actors publish their first intent without displacement, then move normally", () => {
  const { pet, tick, events } = controller();
  for (let i = 0; i < 140; i++) expect(tick()).toBe(false);
  expect(events).toEqual(["roam"]);
  expect(pet.frame.state).toBe("walk");
  expect(pet.x).toBe(environment.bounds.x);
  expect(pet.frame.phase).toBe(0);
  expect(tick()).toBe(true);
  expect(pet.x).toBeGreaterThan(environment.bounds.x);
});

for (const missing of [false, true])
  test(`desktop first intent ${missing ? "fails without" : "waits for"} its entry resource before any host move`, async () => {
    const { engine: ready, poses } = fixture(1300);
    const engine = missing
      ? new AuthoredPoseAnimation(poses, {
          transitions: [],
          stand: native("stand"),
        })
      : ready;
    engine.sample(frame(0));
    const { hook, move } = runtime(engine, (name) => {
      if (name === "roam")
        engine.sample({ ...frame(performance.now() / 1000), mode: "walk" });
    });
    await act(() => vi.advanceTimersByTimeAsync(8400));
    expect(move).not.toHaveBeenCalled();
    if (missing) {
      expect(engine.getMotionFailure()).toBe("needs-authored-transition");
      expect(hook.result.current.error).toBe("");
      expect(hook.result.current.issue?.message).toContain("缺少连续过渡姿势");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(move).not.toHaveBeenCalled();
    } else {
      expect(hook.result.current.frame.state).toBe("walk");
      engine.sample({ ...frame(performance.now() / 1000), mode: "walk" });
      expect(engine.getMotionTransition()?.progress).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(move).toHaveBeenCalled();
    }
    hook.unmount();
  });

test("desktop hook consumes actual public playback feedback and starts its rest clock after completion", async () => {
  const { engine } = fixture(1300);
  engine.sample(frame(0));
  engine.sample({ ...frame(1), mode: "walk" });
  const { hook, move, feedback } = runtime(engine);
  await act(() => vi.advanceTimersByTimeAsync(1600));
  expect(feedback).toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
  engine.sample({ ...frame(2.4), mode: "walk" });
  await act(() => vi.advanceTimersByTimeAsync(6900));
  expect(move).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(move).toHaveBeenCalled();
  hook.unmount();
});

test("desktop press publicly cancels the previous failed selection before following a new drag", async () => {
  const { poses, start } = fixture();
  const broken = structuredClone(start);
  (broken.keyframes[1].pose as AuthoredPose).limbs.legBack.contact![0] += 9;
  const engine = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  engine.sample(frame(0));
  engine.sample({ ...frame(1), mode: "walk" });
  engine.sample({ ...frame(1.6), mode: "walk" });
  const { hook, move, cancel } = runtime(engine);
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(engine.getMotionFailure()).toBe("transition-support-mismatch");
  expect(hook.result.current.issue?.severity).toBe("error");
  expect(hook.result.current.error).toContain("无法保持支撑");
  act(() => {
    hook.result.current.press(450, 470);
    hook.result.current.pointer(480, 490);
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(engine.getMotionFailure()).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.frame.state).toBe("held");
  expect(hook.result.current.error).toBe("");
  expect(move.mock.lastCall?.[0]).toMatchObject({
    manual: true,
    x: 430,
    y: 420,
  });
  hook.unmount();
});

test("actual complete playback freezes confirmed distance and activity age for its registered duration", () => {
  const { engine } = fixture(1300);
  const { pet, tick } = controller();
  engine.sample(frame(0, pet));
  let t = 0;
  while (pet.frame.state === "idle") {
    tick(engine.getMotionTransition());
    engine.sample(frame((t += 0.05), pet));
  }
  const x = pet.x,
    phase = pet.frame.phase;
  for (let i = 0; i < 25; i++) {
    expect(tick(engine.getMotionTransition())).toBe(false);
    engine.sample(frame((t += 0.05), pet));
    expect(pet.x).toBe(x);
    expect(pet.frame.phase).toBe(phase);
  }
  expect(engine.getMotionTransition()?.progress).toBeLessThan(1);
  engine.sample(frame(t + 0.1, pet));
  expect(engine.getMotionTransition()?.progress).toBe(1);
  expect(tick(engine.getMotionTransition())).toBe(true);
  expect(pet.x).toBeGreaterThan(x);
});

for (const fps of [30, 60])
  test(`resource wait retains actual FK world supports at ${fps} fps`, () => {
    const { engine } = fixture(1300);
    const { pet } = controller();
    const dt = 1 / fps;
    engine.sample(frame(0, pet));
    let t = 0;
    while (pet.frame.state === "idle") {
      pet.step(dt, shape);
      t += dt;
    }
    const entry = engine.sample(frame(t, pet))!;
    const points = limbs.map((name) => actual(entry, name));
    const x = pet.x,
      phase = pet.frame.phase;
    for (let i = 0; i < Math.ceil(1.3 * fps) - 1; i++) {
      expect(pet.step(dt, shape, engine.getMotionTransition())).toBe(false);
      const sample = engine.sample(frame((t += dt), pet))!;
      expect(pet.x).toBe(x);
      expect(pet.frame.phase).toBe(phase);
      for (const [i, name] of limbs.entries()) {
        const point = actual(sample, name);
        expect(
          Math.hypot(point[0] - points[i][0], point[1] - points[i][1]),
        ).toBeLessThanOrEqual(1);
      }
    }
    engine.sample(frame(t + dt + 1e-6, pet));
    expect(engine.getMotionTransition()?.progress).toBe(1);
    expect(pet.step(dt, shape, engine.getMotionTransition())).toBe(true);
  });

for (const roam of ["free", "calm"] as const)
  test(`${roam} rest starts after the complete stop resource ends`, () => {
    const { engine } = fixture(900);
    const { pet, tick, events } = controller({ roam });
    engine.sample(frame(0, pet));
    let t = 0;
    while (pet.frame.state === "idle") {
      tick();
      t += 0.05;
    }
    engine.sample(frame(t, pet));
    engine.sample(frame((t += 1), pet));
    pet.stop();
    engine.sample(frame(t, pet));
    expect(engine.getMotionTransition()?.id).toBe("full_stop");
    for (let i = 0; i < 17; i++) {
      tick(engine.getMotionTransition());
      engine.sample(frame((t += 0.05), pet));
    }
    expect(events).toEqual(["roam"]);
    engine.sample(frame((t += 0.1), pet));
    const interval = roam === "free" ? 7 : 17;
    for (let i = 0; i < interval * 20 - 1; i++)
      tick(engine.getMotionTransition());
    expect(events).toEqual(["roam"]);
    tick(engine.getMotionTransition());
    expect(events).toEqual(["roam", "roam"]);
  });

test("resource waiting never blocks the 150ms hold threshold or the held pointer target", () => {
  const { engine } = fixture();
  engine.sample(frame(0));
  engine.sample({ ...frame(1), mode: "walk" });
  const { pet, tick } = controller();
  pet.press(450, 470);
  tick(engine.getMotionTransition());
  tick(engine.getMotionTransition());
  tick(engine.getMotionTransition());
  expect(pet.manual).toBe(true);
  pet.pointer(480, 490);
  expect(tick(engine.getMotionTransition())).toBe(true);
  expect(pet.environment.bounds.x).toBe(430);
  expect(pet.environment.bounds.y).toBe(420);
  expect(pet.frame.grip).toEqual({ x: 50, y: 70 });
});

for (const durationMs of [300, 1100])
  test(`drop delay and ${durationMs}ms playback wait in parallel before attachment`, () => {
    const { engine } = fixture(durationMs);
    engine.sample(frame(0));
    engine.sample({ ...frame(1), mode: "walk" });
    const { pet, tick } = controller(
      { edgeClimbing: true, dropDuration: 0.6 },
      6,
    );
    pet.press(60, 450);
    pet.pointer(65, 450);
    tick();
    pet.release();
    pet.placed(pet.environment, shape);
    const initial = { x: pet.x, y: pet.y };
    let elapsed = 0;
    for (let i = 0; i < Math.max(0.6, durationMs / 1000) * 20 - 1; i++) {
      expect(tick(engine.getMotionTransition())).toBe(false);
      engine.sample({ ...frame(1 + (elapsed += 0.05)), mode: "walk" });
      expect({ x: pet.x, y: pet.y }).toEqual(initial);
    }
    engine.sample({
      ...frame(1 + Math.max(0.6, durationMs / 1000) + 0.01),
      mode: "walk",
    });
    tick(engine.getMotionTransition());
    expect(pet.frame.state).toBe("climb");
    expect(pet.frame.attachment).toBe("settling");
  });

test("public cancellation clears a same-request failure but retries validate the actual entry again", () => {
  const { poses, start, middle } = fixture();
  const broken = structuredClone(start);
  (broken.keyframes[1].pose as AuthoredPose).limbs.legBack.contact![0] += 9;
  const engine = new AuthoredPoseAnimation(poses, { transitions: [broken] });
  engine.sample(frame(0));
  const walking = { ...frame(1), mode: "walk" as const },
    entry = engine.sample(walking)!;
  const first = actual(entry, "legFront");
  engine.sample({ ...walking, t: 1.6 });
  expect(engine.getMotionFailure()).toBe("transition-support-mismatch");
  engine.cancelMotionPlayback();
  expect(engine.getMotionFailure()).toBeNull();
  expect(engine.getMotionTransition()).toBeNull();
  const retry = engine.sample({ ...walking, t: 10 })!;
  expect(retry.transition?.progress).toBe(0);
  expect(retry.pose.part).not.toBe(middle.part);
  expect(actual(retry, "legFront")).toEqual(first);
  engine.sample({ ...walking, t: 10.6 });
  expect(engine.getMotionFailure()).toBe("transition-support-mismatch");
});

test("cancelling a middle cel keeps its joints and refuses missing middle-to-stand recovery", () => {
  const { engine, middle } = fixture();
  engine.sample(frame(0));
  engine.sample({ ...frame(1), mode: "walk" });
  const mid = engine.sample({ ...frame(1.5), mode: "walk" })!;
  expect(mid.pose.part).toBe(middle.part);
  engine.cancelMotionPlayback();
  expect(engine.getMotionTransition()).toBeNull();
  const refused = engine.sample(frame(4))!;
  expect(engine.getMotionFailure()).toBe("needs-authored-transition");
  expect(refused.pose).toEqual(mid.pose);
  for (const name of limbs)
    expect(actual(refused, name)).toEqual(actual(mid, name));
});

function virtual() {
  vi.useFakeTimers();
  let transition: PetPosePlayback | null = null,
    failure: string | null = "old-transition-failure";
  const cancel = vi.fn(() => {
    transition = null;
    failure = null;
  });
  const hook = renderHook(
    ({ demo, key }) =>
      useVirtualMotion(
        demo,
        key,
        220,
        () => 50,
        () => ({ transition, failure }),
        cancel,
      ),
    { initialProps: { demo: null as MotionDemo | null, key: 0 } },
  );
  const stage = document.createElement("div");
  Object.defineProperties(stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 450 },
  });
  hook.result.current.stage.current = stage;
  hook.rerender({ demo: "walk-right", key: 1 });
  return {
    hook,
    cancel,
    status: (p: PetPosePlayback | null) => (transition = p),
    fail: (reason: string) => (failure = reason),
  };
}
test("virtual playback freezes local distance/phase without wall-time catchup", async () => {
  const { hook, status } = virtual();
  await act(() => vi.advanceTimersByTimeAsync(32));
  const before = hook.result.current.placement!;
  status({ id: "registered_start", progress: 0.1 });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(hook.result.current.placement).toEqual(before);
  status({ id: "registered_start", progress: 1 });
  await act(() => vi.advanceTimersByTimeAsync(32));
  const after = hook.result.current.placement!;
  expect(after.left - before.left).toBeGreaterThan(0);
  expect(after.left - before.left).toBeLessThan(3);
  expect(after.frame.phase - before.frame.phase).toBeCloseTo(
    ((after.left - before.left) / 50) * Math.PI * 2,
    8,
  );
  hook.unmount();
});
test("menu rerenders preserve the clock; same-demo replay cancels old failure without resetting position", async () => {
  const { hook, cancel, fail } = virtual();
  await act(() => vi.advanceTimersByTimeAsync(300));
  const before = hook.result.current.placement!,
    calls = cancel.mock.calls.length;
  hook.rerender({ demo: "walk-right", key: 1 });
  expect(cancel).toHaveBeenCalledTimes(calls);
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.placement!.left).toBeGreaterThan(before.left);
  fail("needs-authored-transition");
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(hook.result.current.error).toContain("已停止演示");
  const failed = hook.result.current.placement!;
  hook.rerender({ demo: "walk-right", key: 2 });
  expect(cancel).toHaveBeenCalledTimes(calls + 1);
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.placement!.left).toBe(failed.left);
  expect(hook.result.current.placement!.frame.phase).toBe(failed.frame.phase);
  await act(() => vi.advanceTimersByTimeAsync(64));
  expect(hook.result.current.placement!.left).toBeGreaterThan(failed.left);
  fail("planned-pose-unreachable");
  await act(() => vi.advanceTimersByTimeAsync(16));
  hook.rerender({ demo: "held", key: 3 });
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.placement!.frame.state).toBe("held");
  hook.unmount();
});
