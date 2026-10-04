import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PetLocomotion } from "../src/features/desktop-pet/locomotion/controller";
import { usePetLocomotion } from "../src/features/desktop-pet/locomotion/usePetLocomotion";
import type {
  PetEnvironment,
  PetGeometry,
  PetMotionRequest,
  PetPosePlayback,
} from "../src/platform/petMotion";

const settings = {
  roam: "free" as const,
  size: 220,
  edgeClimbing: true,
  highGliding: true,
  dropDuration: 0.2,
};
const shape: PetGeometry = {
  visible: { x: 0, y: 0, width: 100, height: 100 },
  feet: { x: 50, y: 100 },
  supportedEdges: ["left", "right", "top", "bottom"],
  edges: {
    left: { x: 0, y: 50 },
    right: { x: 100, y: 50 },
    top: { x: 50, y: 0 },
    bottom: { x: 50, y: 100 },
  },
};
function environment(x = 10, y = 300, width = 1000): PetEnvironment {
  return {
    generation: 0,
    revision: 1,
    displayId: 1,
    visible: true,
    bounds: { x, y, width: 140, height: 140 },
    workArea: { x: 0, y: 0, width, height: 800 },
  };
}
function fixture(x = 10, y = 300, width = 1000, geometry = shape) {
  const pet = new PetLocomotion(
    environment(x, y, width),
    settings,
    vi.fn(),
    () => 0.8,
  );
  const tick = (playback?: PetPosePlayback | null) => {
    const moved = pet.step(0.05, geometry, playback);
    if (moved)
      pet.receipt(
        {
          ...pet.environment,
          bounds: { ...pet.environment.bounds, x: pet.x, y: pet.y },
        },
        0.05,
      );
    return moved;
  };
  const place = () => {
    pet.press(x + 50, y + 50);
    pet.pointer(x + 55, y + 50);
    pet.release();
    pet.placed(pet.environment, geometry);
  };
  return { pet, tick, place };
}
const original = window.futurePropsDesktop;
afterEach(() => {
  window.futurePropsDesktop = original;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("post-drop attachment publishes its entry intent before even the first settling displacement", () => {
  const { pet, tick, place } = fixture();
  place();
  for (let i = 0; i < 3; i++) expect(tick()).toBe(false);
  expect(tick()).toBe(false);
  expect(pet.frame).toMatchObject({
    state: "climb",
    edge: "left",
    attachment: "settling",
  });
  expect(pet.x).toBe(10);
  expect(pet.frame.phase).toBe(0);
  const wait = { id: "stand_to_left", progress: 0.1 };
  for (let i = 0; i < 40; i++) expect(tick(wait)).toBe(false);
  expect(pet.x).toBe(10);
  expect(tick({ ...wait, progress: 1 })).toBe(true);
  expect(pet.x).toBeLessThan(10);
  expect(pet.x).toBeGreaterThan(4);
});

for (const edge of ["top", "bottom"] as const)
  test(`${edge} unsupported-corner reversal publishes the new facing before moving inward`, () => {
    const local = { ...shape, supportedEdges: [edge] };
    const { pet, tick, place } = fixture(
      20,
      edge === "top" ? 4 : 696,
      160,
      local,
    );
    place();
    for (let i = 0; i < 200 && pet.x < 56; i++) tick();
    expect(pet.x).toBe(56);
    expect(pet.frame.edge).toBe(edge);
    expect(pet.frame.facing).toBe(-1);
    expect(pet.frame.edgeTurn).toBeUndefined();
    const x = pet.x;
    expect(tick({ id: "authored_reverse", progress: 0.2 })).toBe(false);
    expect(pet.x).toBe(x);
    expect(tick({ id: "authored_reverse", progress: 1 })).toBe(true);
    expect(pet.x).toBeLessThan(x);
  });

for (const roam of ["free", "calm"] as const)
  test(`${roam} pause keeps position and resumes only after a fresh full interval and boundary check`, () => {
    const { pet, tick, place } = fixture();
    place();
    for (let i = 0; i < 20; i++) tick();
    const stopped = { x: pet.x, y: pet.y };
    pet.configure({ ...pet.settings, roam }, true);
    for (let i = 0; i < 500; i++) expect(tick()).toBe(false);
    expect({ x: pet.x, y: pet.y }).toEqual(stopped);
    pet.configure(pet.settings, false);
    const interval = roam === "free" ? 7 : 17;
    for (let i = 0; i < interval * 20 - 1; i++) expect(tick()).toBe(false);
    expect({ x: pet.x, y: pet.y }).toEqual(stopped);
    // Geometry changed while paused; no longer claim a stale support plane.
    const detached = {
      ...shape,
      edges: { ...shape.edges!, left: { x: 100, y: 50 } },
    };
    pet.step(0.05, detached);
    expect(pet.frame.edge).toBeNull();
    expect(pet.frame.state).toBe("idle");
    expect({ x: pet.x, y: pet.y }).toEqual(stopped);
  });

test("a final placement receipt arriving after a second drag release cannot become its placement", async () => {
  vi.useFakeTimers();
  let confirmed = environment(400, 300);
  let finish!: (value: PetEnvironment) => void;
  const move = vi.fn(
    async (request: PetMotionRequest): Promise<PetEnvironment> => {
      confirmed = {
        ...confirmed,
        generation: request.generation,
        revision: confirmed.revision + 1,
        bounds: { ...confirmed.bounds, x: request.x, y: request.y },
      };
      return confirmed;
    },
  );
  move.mockImplementationOnce(
    () =>
      new Promise<PetEnvironment>((resolve) => {
        finish = resolve;
      }),
  );
  window.futurePropsDesktop = {
    petEnvironment: async () => confirmed,
    cancelPetMotion: async (generation: number) =>
      (confirmed = { ...confirmed, generation }),
    movePetFrame: move,
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(() =>
    usePetLocomotion({
      enabled: true,
      blocked: false,
      settings,
      geometry: () => shape,
      onEvent: vi.fn(),
    }),
  );
  await act(async () => {});
  act(() => {
    hook.result.current.press(450, 350);
    hook.result.current.pointer(460, 350);
    hook.result.current.release();
  });
  await act(async () => {});
  expect(move).toHaveBeenCalledTimes(1);
  const old = move.mock.calls[0][0];
  act(() => {
    hook.result.current.press(450, 350);
    hook.result.current.pointer(480, 360);
    hook.result.current.release();
  });
  await act(async () => {});
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({
      ...confirmed,
      generation: old.generation,
      bounds: { ...confirmed.bounds, x: old.x, y: old.y },
    }),
  );
  expect(move).toHaveBeenCalledTimes(2);
  expect(move.mock.calls[1][0]).toMatchObject({ x: 430, y: 310, manual: true });
  expect(move.mock.calls[1][0].generation).toBeGreaterThan(old.generation);
  expect(hook.result.current.environment?.bounds).toMatchObject({
    x: 430,
    y: 310,
  });
  expect(hook.result.current.frame.state).toBe("idle");
  hook.unmount();
});

test("a new stationary 150ms hold is recognised while the cancelled previous final receipt is still pending", async () => {
  vi.useFakeTimers();
  let confirmed = environment();
  let finish!: (value: PetEnvironment) => void;
  const move = vi.fn((request: PetMotionRequest) => {
    expect(request.manual).toBe(true);
    return new Promise<PetEnvironment>((resolve) => {
      finish = resolve;
    });
  });
  window.futurePropsDesktop = {
    petEnvironment: async () => confirmed,
    cancelPetMotion: async (generation: number) =>
      (confirmed = { ...confirmed, generation }),
    movePetFrame: move,
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
  const hook = renderHook(() =>
    usePetLocomotion({
      enabled: true,
      blocked: false,
      settings,
      geometry: () => shape,
      onEvent: vi.fn(),
    }),
  );
  await act(async () => {});
  act(() => {
    hook.result.current.press(60, 350);
    hook.result.current.pointer(65, 350);
    hook.result.current.release();
  });
  await act(async () => {});
  expect(move).toHaveBeenCalledOnce();
  const old = move.mock.calls[0][0] as unknown as PetMotionRequest;
  act(() => hook.result.current.press(60, 350));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(hook.result.current.frame.state).toBe("held");
  expect(move).toHaveBeenCalledOnce(); // The in-flight RPC is still exclusive.
  act(() => hook.result.current.release(true));
  await act(async () =>
    finish({
      ...confirmed,
      generation: old.generation,
      bounds: { ...confirmed.bounds, x: old.x, y: old.y },
    }),
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(hook.result.current.frame.edge).toBeNull();
  expect(hook.result.current.frame.state).toBe("idle");
  hook.unmount();
});
