import { forwardRef, useEffect, useImperativeHandle } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PetRuntime } from "@features/desktop-pet/PetRuntime";
import {
  motionIssue,
  usePetLocomotion,
} from "@features/desktop-pet/locomotion/usePetLocomotion";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import type { FrameSequences } from "@features/desktop-pet/sequences/types";
import type {
  PetEnvironment,
  PetGeometry,
  PetMotionRequest,
  PetMotionFrame,
} from "@platform/petMotion";

const state = vi.hoisted(() => ({
  player: null as SequencePlayer | null,
  override: null as string | null,
  previewError: "",
  get: vi.fn(),
  update: vi.fn(),
  model: vi.fn(),
}));
vi.mock("@features/desktop-pet/api", () => ({
  getDocument: state.get,
  getChat: async () => ({ proactiveLinesEnabled: false }),
  updateDocument: state.update,
  sendChat: state.model,
}));
vi.mock("@shared/ui/theme", () => ({ useTheme: () => undefined }));
vi.mock("@features/desktop-pet/usePetPreview", () => ({
  usePetPreview: () => ({
    linked: false,
    display: null,
    paused: false,
    error: state.previewError,
  }),
}));
// The component boundary uses the production player, without fabricating a
// legacy pose or a renderer failure string for missing whole-frame actions.
vi.mock("@features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: forwardRef(function Figure(
    props: {
      eventName: string;
      locomotion?: PetMotionFrame | null;
    },
    ref,
  ) {
    useEffect(() => {
      const clip =
        props.locomotion?.state === "held"
          ? "held"
          : props.eventName === "grab"
            ? "held"
            : props.eventName === "drop"
              ? "drop"
              : props.eventName === "click"
                ? "hop"
                : "idle";
      state.player?.sample({ clip, t: performance.now() / 1000 });
    }, [props.eventName, props.locomotion?.state]);
    useImperativeHandle(ref, () => ({
      hitTest: () => true,
      geometry: () => geometry,
      placementGeometry: () => geometry,
      motionFailure: () =>
        state.override ?? state.player?.getMotionFailure() ?? null,
      cancelMotionPlayback: () => state.player?.cancelMotionPlayback(),
    }));
    return <div data-testid="figure" data-event={props.eventName} />;
  }),
}));

function pack(): FrameSequences {
  return {
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
}
const geometry: PetGeometry = {
  visible: { x: 0, y: 0, width: 100, height: 200 },
  feet: { x: 50, y: 190 },
};
const settings = {
  roam: "off" as const,
  size: 220,
  edgeClimbing: false,
  highGliding: false,
};
const originalBridge = window.futurePropsDesktop;
let environment: PetEnvironment;
const move = vi.fn(),
  cancel = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  state.player = new SequencePlayer(pack());
  state.player.sample({ clip: "idle", t: 0 });
  state.override = null;
  state.previewError = "";
  state.update.mockReset();
  state.model.mockReset();
  state.get.mockReset().mockResolvedValue({
    revision: 1,
    sourceType: "coopanion-whale",
    sourceRevision: 1,
    whaleModel: { schemes: [{ id: "classic" }], frameSequences: pack() },
    whaleAssets: {},
    assetUrls: {},
    character: null,
    config: {
      schemaVersion: 2,
      schemeId: "classic",
      skins: [],
      events: {
        click: { motionId: "hop", expressionId: "surprised", lines: [] },
      },
      habits: {
        ...settings,
        draggable: true,
        bubbles: false,
        sound: false,
        hoverActions: [],
      },
    },
  });
  environment = {
    generation: 0,
    revision: 0,
    displayId: 1,
    visible: true,
    bounds: { x: 400, y: 200, width: 300, height: 400 },
    workArea: { x: 0, y: 0, width: 1600, height: 1000 },
  };
  cancel.mockReset().mockImplementation(async (generation: number) => {
    environment = { ...environment, generation };
    return environment;
  });
  move.mockReset().mockImplementation(async (request: PetMotionRequest) => {
    environment = {
      ...environment,
      generation: request.generation,
      bounds: { ...environment.bounds, x: request.x, y: request.y },
    };
    return environment;
  });
  window.futurePropsDesktop = {
    petEnvironment: async () => environment,
    movePetFrame: move,
    cancelPetMotion: cancel,
    setPetInteractive: vi.fn(),
    showStudioFromPet: vi.fn(),
  } as unknown as NonNullable<typeof window.futurePropsDesktop>;
});
afterEach(() => {
  window.futurePropsDesktop = originalBridge;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  "sequence:missing-clip",
  "sequence:missing-frame",
  "sequence:missing-transition",
  "sequence:missing-transition-branch",
  "needs-authored-transition",
  "needs-stand-view",
  "needs-authored-turn-basis",
  "needs-walk-turn-view",
  "unsupported-motion-resource",
])("explicit resource capability %s is a typed warning", (code) => {
  expect(motionIssue(code)).toMatchObject({
    kind: "resource-unavailable",
    severity: "warning",
    code,
  });
});
test.each([
  "sequence:missing-support",
  "sequence:invalid-support-motion",
  "sequence:support-conflict",
  "sequence:support-registration-mismatch",
  "sequence:missing-confirmed-travel",
  "sequence:head-scale-mismatch",
  "transition-support-mismatch",
  "planned-pose-unreachable",
  "texture decoding failed",
  "unsupported-unrecognized-protocol",
  "future-unknown-error",
])(
  "registration, transport-contract or unknown renderer failure %s stays an error",
  (code) => {
    expect(motionIssue(code)).toMatchObject({
      kind: "pose-invalid",
      severity: "error",
      code,
    });
  },
);

function runtimeHook() {
  return renderHook(() =>
    usePetLocomotion({
      enabled: true,
      settings,
      blocked: false,
      geometry: () => geometry,
      motionFailure: () => state.override ?? state.player!.getMotionFailure(),
      cancelPlayback: () => state.player!.cancelMotionPlayback(),
      onEvent: vi.fn(),
    }),
  );
}
test("real missing-clip keeps the current cel, cancels once and does not erase the warning on the cancel receipt", async () => {
  const displayed = state.player!.sample({ clip: "idle", t: 0 })!;
  const hook = runtimeHook();
  await act(async () => undefined);
  const rejected = state.player!.sample({ clip: "held", t: 0.1 })!;
  expect(rejected.frame).toEqual(displayed.frame);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.issue).toMatchObject({
    severity: "warning",
    code: "sequence:missing-clip",
  });
  expect(cancel).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(cancel).toHaveBeenCalledOnce();
  expect(hook.result.current.issue?.message).toContain("缺少此动作");
  expect(move).not.toHaveBeenCalled();
  expect(hook.result.current.frame.state).toBe("idle");
  hook.unmount();
});
test("a valid new playback clears a resource warning and waits a new activity interval", async () => {
  const hook = runtimeHook();
  await act(async () => undefined);
  state.player!.sample({ clip: "held", t: 0.1 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  state.player!.cancelMotionPlayback();
  state.player!.sample({ clip: "idle", t: 0.2 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.issue).toBeNull();
  expect(move).not.toHaveBeenCalled();
  hook.unmount();
});
test("a real support failure supersedes the earlier resource warning", async () => {
  const hook = runtimeHook();
  await act(async () => undefined);
  state.player!.sample({ clip: "held", t: 0.1 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  state.override = "sequence:support-conflict";
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.issue).toMatchObject({
    severity: "error",
    code: state.override,
  });
  expect(hook.result.current.error).toContain("支撑点相互冲突");
  expect(move).not.toHaveBeenCalled();
  hook.unmount();
});
test("a host cancel rejection remains a transport error rather than a resource warning", async () => {
  cancel.mockRejectedValueOnce(new Error("host unavailable"));
  const hook = runtimeHook();
  await act(async () => undefined);
  state.player!.sample({ clip: "held", t: 0.1 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.issue).toMatchObject({
    kind: "transport",
    severity: "error",
    code: "cancel-failed",
  });
  expect(hook.result.current.error).toContain("运动中断失败");
  hook.unmount();
});
test("a host move rejection preserves the communication error and the confirmed bounds", async () => {
  move.mockRejectedValueOnce(new Error("connection closed"));
  const hook = runtimeHook();
  await act(async () => undefined);
  act(() => {
    hook.result.current.press(450, 300);
    hook.result.current.pointer(460, 300);
  });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(hook.result.current.issue).toMatchObject({
    kind: "transport",
    severity: "error",
    code: "move-failed",
  });
  expect(hook.result.current.error).toContain("走动失败");
  expect(hook.result.current.environment?.bounds.x).toBe(400);
  hook.unmount();
});

async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<PetRuntime projectId="diagnostic" />);
  });
  const host = view.container.firstElementChild as HTMLElement;
  host.setPointerCapture = vi.fn();
  return { ...view, host };
}
function pointer(host: HTMLElement, type: string, screenX = 450) {
  fireEvent(
    host,
    new MouseEvent(type, {
      bubbles: true,
      screenX,
      screenY: 300,
      clientX: 50,
      clientY: 150,
    }),
  );
}
test("a 44ms zero-displacement short body click reports missing resources without a state-abnormal alert or a host move", async () => {
  const view = await mount();
  pointer(view.host, "pointerdown");
  await act(() => vi.advanceTimersByTimeAsync(44));
  pointer(view.host, "pointerup");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.getByTestId("figure")).toHaveAttribute("data-event", "click");
  expect(screen.getByRole("button", { name: "动作资源未齐" })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("桌宠状态异常")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "动作资源未齐" }));
  expect(screen.getByText(/缺少此动作的完整画面/)).toBeVisible();
  expect(move).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.model).not.toHaveBeenCalled();
  view.unmount();
});
test.each(["150ms", ">4DIP"])(
  "missing held/drop in the %s gesture retains the cel and uses a resource status",
  async (gesture) => {
    const view = await mount();
    const first = state.player!.sample({ clip: "idle", t: 0 })!.frame;
    pointer(view.host, "pointerdown");
    if (gesture === ">4DIP") pointer(view.host, "pointermove", 455);
    await act(() =>
      vi.advanceTimersByTimeAsync(gesture === "150ms" ? 220 : 100),
    );
    // Flush the newly rendered held cel request, then let the hook consume
    // its public renderer feedback on the next tick.
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByRole("button", { name: "动作资源未齐" })).toBeVisible();
    expect(
      state.player!.holdMotionPlayback({ clip: "held", t: 0.4 })?.frame,
    ).toEqual(first);
    pointer(view.host, "pointermove", 480);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(move.mock.lastCall?.[0]).toMatchObject({
      manual: true,
      x: 430,
      y: 200,
      grab: expect.any(Object),
    });
    expect(environment.bounds.x).toBe(430);
    expect(screen.getByRole("button", { name: "动作资源未齐" })).toBeVisible();
    pointer(view.host, "pointerup");
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(move.mock.lastCall?.[0]).toMatchObject({
      manual: true,
      x: 430,
      y: 200,
    });
    expect(move.mock.lastCall?.[0]).not.toHaveProperty("grab");
    expect(environment.bounds.x).toBe(430);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.update).not.toHaveBeenCalled();
    view.unmount();
  },
);
test("real runtime errors have priority over the resource warning", async () => {
  state.previewError = "预览通信失败";
  const view = await mount();
  state.player!.sample({ clip: "held", t: 0.1 });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.getByRole("button", { name: "桌宠状态异常" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("预览通信失败");
  expect(screen.queryByRole("button", { name: "动作资源未齐" })).toBeNull();
  view.unmount();
});
test.each(["pointercancel", "lostpointercapture"])(
  "%s after a missing held cel does not confirm a placement or write configuration",
  async (event) => {
    const view = await mount();
    pointer(view.host, "pointerdown");
    pointer(view.host, "pointermove", 455);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByRole("button", { name: "动作资源未齐" })).toBeVisible();
    const moveCount = move.mock.calls.length;
    pointer(view.host, event);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(move).toHaveBeenCalledTimes(moveCount);
    expect(view.host).toHaveAttribute("data-motion", "idle");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.model).not.toHaveBeenCalled();
    const regrabOrigin = environment.bounds.x;
    pointer(view.host, "pointerdown", 455);
    pointer(view.host, "pointermove", 485);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(move.mock.lastCall?.[0]).toMatchObject({
      manual: true,
      x: regrabOrigin + 30,
    });
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();
  },
);
test("runtime preserves a true support alert and displays its specific registration reason", async () => {
  const view = await mount();
  state.override = "sequence:support-registration-mismatch";
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(screen.getByRole("button", { name: "桌宠状态异常" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("支撑点登记不一致");
  expect(screen.queryByRole("button", { name: "动作资源未齐" })).toBeNull();
  expect(move).not.toHaveBeenCalled();
  view.unmount();
});
