import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { usePetLocomotion } from "@features/desktop-pet/locomotion/usePetLocomotion";
import type {
  PetEnvironment,
  PetMotionFrame,
  PetMotionRequest,
} from "@platform/petMotion";

const originalBridge = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = originalBridge;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stage(
  scale = 0.7933,
  origin = { x: -1142.25, y: 468.5 },
  withOrigin = true,
) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const viewport = { ...origin };
  const source = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  source.setAttribute("x", "20");
  source.setAttribute("y", "30");
  source.setAttribute("width", "216");
  source.setAttribute("height", "226");
  group.append(source);
  let S = scale;
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(
        "http://www.w3.org/2000/svg",
        "ellipse",
      ),
      fxG: document.createElementNS("http://www.w3.org/2000/svg", "g"),
    },
    {
      roam: "off",
      walkInPlace: true,
      startX: 140,
      sfx: new Proxy({}, { get: () => () => undefined }),
      bounds: () => ({ W: 280, H: 400, floorY: 380, S }),
      ...(withOrigin ? { viewportOrigin: () => viewport } : {}),
      figure: {
        fixedScale: true,
        pickupPoint: () => [128, 188],
        draw: () => undefined,
      },
    },
  );
  const held: PetMotionFrame = {
    state: "held",
    facing: 1,
    edge: null,
    phase: 0,
    velocity: { x: 0, y: 0 },
    swing: 0,
    grip: { x: 150, y: 346.08 },
  };
  pet.render();
  pet.setLocomotion(held);
  for (let i = 0; i < 20; i++) {
    pet.step(1 / 60);
    pet.render();
  }
  // Evaluate the actual production SVG transform for a fixed source point;
  // these are painted-cel registration gauges, not anatomical support metadata.
  function world(point: [number, number] = [100, 120]) {
    const t = group.getAttribute("transform")!;
    const [x, y] = t
      .match(/^translate\(([^)]+)\)/)![1]
      .split(" ")
      .map(Number);
    const rotation = (Number(t.match(/rotate\(([^)]+)\)/)![1]) * Math.PI) / 180;
    const [sx, sy] = t
      .match(/scale\(([^)]+)\)/)![1]
      .split(" ")
      .map(Number);
    const dx = (point[0] - 128) * sx,
      dy = (point[1] - 256) * sy;
    return [
      viewport.x + x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      viewport.y + y + dx * Math.sin(rotation) + dy * Math.cos(rotation),
    ];
  }
  const tick = () => {
    pet.step(1 / 60);
    pet.render();
  };
  return {
    pet,
    group,
    source,
    viewport,
    held,
    world,
    tick,
    resize: (next: number) => {
      S = next;
      pet.resize();
    },
  };
}
test.each([0.7933, 1.2735])(
  "pending placement at model scale %s counters actual viewport deltas before an IPC receipt or React commit",
  (scale) => {
    const s = stage(scale);
    const before = s.world();
    expect(s.pet.beginPlacementHandoff(4)).toBe(true);
    s.viewport.y += 20;
    // Re-arming the same token before the next render must not sample the
    // stale local transform at the newly moved window as a new world anchor.
    expect(s.pet.beginPlacementHandoff(4)).toBe(true);
    s.tick();
    expect(
      Math.hypot(s.world()[0] - before[0], s.world()[1] - before[1]),
    ).toBeLessThan(0.08);
    for (const delta of [
      { x: 0, y: 20 },
      { x: 3.75, y: 12.125 },
      { x: -12.4, y: -17.5 },
    ]) {
      s.viewport.x += delta.x;
      s.viewport.y += delta.y;
      s.pet.setLocomotion(s.held);
      s.tick();
      expect(
        Math.hypot(s.world()[0] - before[0], s.world()[1] - before[1]),
      ).toBeLessThan(0.08);
      expect(s.group.firstChild).toBe(s.source);
      expect(s.group.getAttribute("transform")).toContain(
        `scale(${scale.toFixed(4)} ${scale.toFixed(4)})`,
      );
    }
    expect(s.pet.commitPlacementHandoff(4)).toBe(true);
    s.viewport.y += 7.25;
    s.pet.setLocomotion(s.held);
    s.tick();
    expect(
      Math.hypot(s.world()[0] - before[0], s.world()[1] - before[1]),
    ).toBeLessThan(0.08);
    // Consume idle in the same render handoff. A bogus legacy shift must not
    // be subtracted a second time from the actually compensated position.
    s.pet.setLocomotion({
      ...s.held,
      state: "idle",
      placementShift: { x: 999, y: 999 },
    });
    s.pet.render();
    expect(
      Math.hypot(s.world()[0] - before[0], s.world()[1] - before[1]),
    ).toBeLessThan(0.08);
    expect(s.pet.commitPlacementHandoff(4)).toBe(false);
  },
);
test("cancellation clears the old token and a late commit cannot release a new placement latch", () => {
  const s = stage();
  expect(s.pet.beginPlacementHandoff(6)).toBe(true);
  s.viewport.y += 20;
  s.tick();
  const before = s.world();
  expect(s.pet.cancelPlacementHandoff()).toBe(true);
  s.pet.render();
  expect(s.world()).toEqual(before);
  expect(s.pet.commitPlacementHandoff(6)).toBe(false);
  s.pet.setLocomotion({ ...s.held, grip: { x: 150, y: 326.08 } });
  s.pet.render();
  expect(s.pet.beginPlacementHandoff(8)).toBe(true);
  const newWorld = s.world();
  expect(s.pet.commitPlacementHandoff(6)).toBe(false);
  s.viewport.x += 30;
  s.tick();
  expect(
    Math.hypot(s.world()[0] - newWorld[0], s.world()[1] - newWorld[1]),
  ).toBeLessThan(0.08);
  expect(s.pet.cancelPlacementHandoff()).toBe(true);
  expect(s.pet.cancelPlacementHandoff()).toBe(false);
});
test("legacy consumers without a real viewport callback do not invent a screen origin", () => {
  const s = stage(0.7933, { x: 0, y: 0 }, false);
  expect(s.pet.beginPlacementHandoff(1)).toBe(false);
  expect(s.pet.commitPlacementHandoff(1)).toBe(false);
  expect(s.pet.cancelPlacementHandoff()).toBe(false);
});
test("invalid screen coordinates cannot arm a latch, and resizing invalidates an existing token", () => {
  const s = stage();
  s.viewport.x = Infinity;
  expect(s.pet.beginPlacementHandoff(4)).toBe(false);
  s.viewport.x = -900.5;
  expect(s.pet.beginPlacementHandoff(4)).toBe(true);
  s.resize(1.25);
  expect(s.pet.commitPlacementHandoff(4)).toBe(false);
  expect(s.pet.cancelPlacementHandoff()).toBe(false);
});

const settings = {
  roam: "off" as const,
  size: 220,
  edgeClimbing: false,
  highGliding: false,
};
const shape = {
  visible: { x: 20, y: 10, width: 180, height: 230 },
  feet: { x: 110, y: 250 },
};
function hookFixture(core?: ReturnType<typeof stage>) {
  vi.useFakeTimers();
  let env: PetEnvironment = {
    generation: 0,
    revision: 1,
    displayId: 1,
    visible: true,
    bounds: { x: -1200, y: 400, width: 300, height: 400 },
    workArea: { x: -1600, y: 0, width: 1600, height: 1000 },
  };
  let resolveFinal!: (value: PetEnvironment) => void;
  let available = true;
  const begin = vi.fn(
      (token: number) => core?.pet.beginPlacementHandoff(token) ?? true,
    ),
    commit = vi.fn(
      (token: number) => core?.pet.commitPlacementHandoff(token) ?? true,
    ),
    cancel = vi.fn(() => {
      core?.pet.cancelPlacementHandoff();
    });
  const move = vi.fn(async (request: PetMotionRequest) => {
    if (core) Object.assign(core.viewport, { x: request.x, y: request.y });
    if (!request.grab)
      return new Promise<PetEnvironment>((resolve) => {
        resolveFinal = resolve;
      });
    env = { ...env, bounds: { ...env.bounds, x: request.x, y: request.y } };
    return env;
  });
  const cancelHost = vi.fn(
    async (generation: number) => (env = { ...env, generation }),
  );
  window.futurePropsDesktop = {
    petEnvironment: async () => env,
    movePetFrame: move,
    cancelPetMotion: cancelHost,
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(
    ({ blocked, revision }) =>
      usePetLocomotion({
        enabled: true,
        settings,
        blocked,
        resourceRevision: revision,
        geometry: () => (available ? shape : null),
        placementGeometry: () => (available ? shape : null),
        placementDelta: () => ({ x: 0, y: 20 }),
        beginPlacementHandoff: begin,
        commitPlacementHandoff: commit,
        cancelPlacementHandoff: cancel,
        onEvent: vi.fn(),
      }),
    { initialProps: { blocked: false, revision: 1 } },
  );
  return {
    hook,
    begin,
    commit,
    cancel,
    cancelHost,
    move,
    env: () => env,
    available: (value: boolean) => {
      available = value;
    },
    finish: () => resolveFinal({ ...env, bounds: { ...env.bounds, y: 420 } }),
  };
}
async function release(f: ReturnType<typeof hookFixture>) {
  await act(async () => undefined);
  act(() => {
    f.hook.result.current.press(-1100, 500);
    f.hook.result.current.pointer(-1095, 500);
  });
  await act(() => vi.advanceTimersByTimeAsync(100));
  act(() => f.hook.result.current.release());
  await act(async () => undefined);
}
test("the public latch is armed synchronously before the final RPC and committed only for its confirmed generation", async () => {
  const f = hookFixture();
  await release(f);
  expect(f.begin).toHaveBeenCalledOnce();
  const token = f.begin.mock.calls[0][0];
  expect(f.move.mock.lastCall?.[0]).toMatchObject({
    manual: true,
    y: 420,
    generation: token,
  });
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.hook.result.current.frame.state).toBe("held");
  await act(async () => f.finish());
  expect(f.commit).toHaveBeenCalledWith(token);
  expect(f.hook.result.current.frame.state).toBe("idle");
  f.hook.unmount();
});
test("the real hook/core path holds world registration while native position changes before its delayed receipt", async () => {
  const core = stage(1.2735, { x: -1200, y: 400 });
  const f = hookFixture(core);
  await act(async () => undefined);
  act(() => {
    f.hook.result.current.press(-1100, 500);
    f.hook.result.current.pointer(-1095, 500);
  });
  await act(() => vi.advanceTimersByTimeAsync(100));
  core.pet.setLocomotion({ ...core.held });
  core.tick();
  const before = core.world();
  act(() => f.hook.result.current.release());
  await act(async () => undefined);
  expect(core.viewport.y).toBe(420);
  expect(f.commit).not.toHaveBeenCalled();
  core.pet.setLocomotion({ ...core.held });
  core.tick();
  expect(
    Math.hypot(core.world()[0] - before[0], core.world()[1] - before[1]),
  ).toBeLessThan(0.08);
  await act(async () => f.finish());
  expect(f.commit).toHaveBeenCalledOnce();
  // Still the previous React frame: the pending world latch remains effective.
  core.pet.setLocomotion({ ...core.held });
  core.tick();
  expect(
    Math.hypot(core.world()[0] - before[0], core.world()[1] - before[1]),
  ).toBeLessThan(0.08);
  core.pet.setLocomotion(f.hook.result.current.frame);
  core.pet.render();
  expect(
    Math.hypot(core.world()[0] - before[0], core.world()[1] - before[1]),
  ).toBeLessThan(0.08);
  f.hook.unmount();
});
test.each([
  "geometry",
  "cancel-undefined",
  "cancel-rejected",
  "missing-bridge",
])(
  "%s cannot leave a placement latch armed without a final confirmation",
  async (failure) => {
    const f = hookFixture();
    await act(async () => undefined);
    act(() => {
      f.hook.result.current.press(-1100, 500);
      f.hook.result.current.pointer(-1095, 500);
    });
    await act(() => vi.advanceTimersByTimeAsync(100));
    if (failure === "geometry") f.available(false);
    else if (failure === "missing-bridge")
      Reflect.deleteProperty(window.futurePropsDesktop!, "movePetFrame");
    else if (failure === "cancel-undefined")
      f.cancelHost.mockResolvedValueOnce(
        undefined as unknown as PetEnvironment,
      );
    else f.cancelHost.mockRejectedValueOnce(new Error("host cancelled"));
    const count = f.cancel.mock.calls.length;
    act(() => f.hook.result.current.release());
    await act(async () => undefined);
    expect(f.begin).toHaveBeenCalledOnce();
    expect(f.cancel.mock.calls.length).toBeGreaterThan(count);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.hook.result.current.issue?.severity).toBe("error");
    expect(f.hook.result.current.issue?.code).toBe(
      failure === "geometry"
        ? "placement-geometry-unavailable"
        : failure === "missing-bridge"
          ? "placement-unconfirmed"
          : "cancel-failed",
    );
    expect(f.hook.result.current.frame.state).toBe("idle");
    f.hook.unmount();
  },
);
test.each(["regrab", "cancel", "pause", "resource", "unmount"])(
  "%s invalidates a pending placement before its late final receipt",
  async (action) => {
    const f = hookFixture();
    await release(f);
    const cancelledBefore = f.cancel.mock.calls.length;
    act(() => {
      if (action === "regrab") f.hook.result.current.press(-1095, 500);
      else if (action === "cancel") f.hook.result.current.release(true);
      else if (action === "pause")
        f.hook.rerender({ blocked: true, revision: 1 });
      else if (action === "resource")
        f.hook.rerender({ blocked: false, revision: 2 });
      else f.hook.unmount();
    });
    expect(f.cancel.mock.calls.length).toBeGreaterThan(cancelledBefore);
    await act(async () => f.finish());
    expect(f.commit).not.toHaveBeenCalled();
    if (action !== "unmount") f.hook.unmount();
  },
);
