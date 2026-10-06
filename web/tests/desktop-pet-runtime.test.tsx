import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PetRuntime } from "../src/features/desktop-pet/PetRuntime";

const state = vi.hoisted(() => ({
  roam: "calm",
  linked: false,
  chat: null as ((value: { phase: string }) => void) | null,
  refresh: null as (() => void) | null,
  revision: 1,
  legacyHuman: false,
  hitRegion: undefined as "head" | "body" | null | undefined,
  pixelHit: true,
  hoverActions: ["roam"] as ("roam" | "chat")[],
  opaqueContact: null as { x: number; y: number } | null,
  geometryAvailable: true,
  geometry: vi.fn(),
}));
vi.mock("../src/features/desktop-pet/usePetPreview", () => ({
  usePetPreview: () => ({
    linked: state.linked,
    paused: state.linked,
    display: null,
    error: "",
  }),
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  getChat: async () => ({ proactiveLinesEnabled: false }),
  getDocument: async () => ({
    revision: state.revision,
    sourceType: "coopanion-whale",
    whaleModel: {
      schemes: [{ id: "deepseek" }],
      ...(state.legacyHuman
        ? { rigProfile: "human-chibi", motionRig: { version: 1 } }
        : {}),
    },
    config: {
      events: { roam: { motionId: "walk" } },
      habits: {
        roam: state.roam,
        size: 220,
        draggable: true,
        bubbles: false,
        sound: false,
        hoverActions: state.hoverActions,
      },
    },
  }),
}));
vi.mock("../src/features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: forwardRef(function Figure(
    {
      eventName,
      document,
    }: { eventName: string; document: { revision: number } },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      hitTest: (x: number, y: number) =>
        state.pixelHit ||
        Boolean(
          state.opaqueContact &&
          Math.abs(x - state.opaqueContact.x) < 0.00001 &&
          Math.abs(y - state.opaqueContact.y) < 0.00001,
        ),
      classifyHit: () => state.hitRegion,
      ...(state.geometryAvailable ? { geometry: () => state.geometry() } : {}),
    }));
    return (
      <div data-testid="figure" data-revision={document.revision}>
        {eventName}
      </div>
    );
  }),
}));

const move = vi.fn();
const interactiveBridge = vi.fn();
const previousDesktop = window.futurePropsDesktop;
beforeEach(() => {
  vi.useFakeTimers();
  state.roam = "calm";
  state.linked = false;
  state.chat = null;
  state.refresh = null;
  state.revision = 1;
  state.legacyHuman = false;
  state.hitRegion = undefined;
  state.pixelHit = true;
  state.opaqueContact = null;
  state.hoverActions = ["roam"];
  state.geometryAvailable = true;
  state.geometry.mockReset().mockReturnValue({
    visible: { x: 100, y: 100, width: 100, height: 200 },
    feet: { x: 150, y: 300 },
  });
  interactiveBridge.mockReset();
  vi.spyOn(Math, "random").mockReturnValue(0.9);
  move
    .mockReset()
    .mockImplementation(async (x: number, y: number) => ({ x, y }));
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      movePet: move,
      setPetInteractive: interactiveBridge,
      onPetChatState: (callback: typeof state.chat) => {
        state.chat = callback;
        return () => {
          state.chat = null;
        };
      },
      onPetResourcesChanged: (callback: () => void) => {
        state.refresh = callback;
        return () => {
          state.refresh = null;
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
    value: previousDesktop,
  });
});

async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<PetRuntime projectId="pet-1" />);
  });
  fireEvent.pointerMove(view.container.firstElementChild!);
  return view;
}

test.each(["head", "body", null, undefined] as const)(
  "short native taps use renderer classification %s rather than the host head band",
  async (region) => {
    state.roam = "off";
    state.hitRegion = region;
    const view = await mount();
    const host = view.container.firstElementChild as HTMLElement;
    host.setPointerCapture = vi.fn();
    // Client Y=242 is the native held face below the previous top-48% head band.
    for (const type of ["pointerdown", "pointerup"])
      fireEvent(
        host,
        new MouseEvent(type, {
          bubbles: true,
          clientX: 223,
          clientY: 242,
          screenX: 223,
          screenY: 242,
        }),
      );
    expect(screen.getByTestId("figure").textContent).toBe(
      region === "head" ? "pet" : region === null ? "idle" : "click",
    );
    view.unmount();
  },
);

test("legacy human resource remains draggable but does not invoke old autonomous motion", async () => {
  state.legacyHuman = true;
  state.roam = "free";
  const view = await mount();
  expect(screen.getByRole("status", { name: /已暂停旧分件动画/ })).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(25000));
  expect(move).not.toHaveBeenCalled();
  expect(screen.getByTestId("figure").textContent).toBe("idle");
  const host = view.container.firstElementChild as HTMLElement;
  host.setPointerCapture = vi.fn();
  fireEvent(
    host,
    new MouseEvent("pointerdown", {
      bubbles: true,
      screenX: 100,
      screenY: 180,
    }),
  );
  await act(async () => {
    fireEvent(
      host,
      new MouseEvent("pointermove", {
        bubbles: true,
        screenX: 130,
        screenY: 200,
      }),
    );
  });
  expect(move).toHaveBeenCalledWith(window.screenX + 30, window.screenY + 20);
  fireEvent.pointerUp(host);
  expect(screen.getByTestId("figure").textContent).toBe("drop");
  view.unmount();
});

test("resource refresh updates the figure without interrupting chat state and ignores stale snapshots", async () => {
  const view = await mount();
  await act(async () => state.chat?.({ phase: "thinking" }));
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.revision = 2;
  await act(async () => state.refresh?.());
  expect(screen.getByTestId("figure")).toHaveAttribute("data-revision", "2");
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.revision = 1;
  await act(async () => state.refresh?.());
  expect(screen.getByTestId("figure")).toHaveAttribute("data-revision", "2");
  view.unmount();
  expect(state.refresh).toBeNull();
});

test("calm roaming moves after 17 seconds and stops after unmount", async () => {
  const view = await mount();
  await act(() => vi.advanceTimersByTimeAsync(16999));
  expect(move).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(move).toHaveBeenCalledWith(25, 0);
  expect(screen.getByTestId("figure")).toHaveTextContent("roam");
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("switching modes shows the current state, moves immediately, and off stops the timer", async () => {
  await mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "走动：多待着" })),
  );
  expect(screen.getByRole("button", { name: "走动：常走动" })).toBeVisible();
  expect(move).toHaveBeenLastCalledWith(55, 0);
  await act(() => vi.advanceTimersByTimeAsync(7000));
  expect(move).toHaveBeenLastCalledWith(110, 0);
  fireEvent.click(screen.getByRole("button", { name: "走动：常走动" }));
  expect(screen.getByRole("button", { name: "走动：不乱动" })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(move).toHaveBeenCalledTimes(2);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "走动：不乱动" })),
  );
  expect(move).toHaveBeenLastCalledWith(135, 0);
});

test("a clamped screen-edge move tries the opposite direction", async () => {
  await mount();
  move.mockResolvedValueOnce({ x: 0, y: 0 });
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move.mock.calls).toEqual([
    [25, 0],
    [-25, 0],
  ]);
});

test("roaming waits while chatting and resumes after closing chat", async () => {
  await mount();
  act(() => state.chat?.({ phase: "open" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).not.toHaveBeenCalled();
  await act(async () => state.chat?.({ phase: "closed" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("starting or releasing a paused link preserves the active chat reaction", async () => {
  const view = await mount();
  act(() => {
    state.chat?.({ phase: "open" });
    state.chat?.({ phase: "thinking" });
  });
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.linked = true;
  view.rerender(<PetRuntime projectId="pet-1" />);
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).not.toHaveBeenCalled();
  state.linked = false;
  view.rerender(<PetRuntime projectId="pet-1" />);
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  await act(async () => state.chat?.({ phase: "closed" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("a failed move displays an error and a later successful move clears it", async () => {
  await mount();
  move.mockRejectedValueOnce(new Error("IPC unavailable"));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(screen.getByRole("alert")).toHaveTextContent("走动失败");
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("disabling roaming ignores a pending receipt and does not request an edge retry", async () => {
  state.roam = "free";
  await mount();
  let resolve!: (bounds: { x: number; y: number }) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => vi.advanceTimersByTimeAsync(7000));
  fireEvent.click(screen.getByRole("button", { name: "走动：常走动" }));
  await act(async () => resolve({ x: 0, y: 0 }));
  expect(move).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("figure")).toHaveTextContent("idle");
});

test("a slow host response does not overlap another roaming request", async () => {
  await mount();
  let resolve!: (bounds: { x: number; y: number }) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => vi.advanceTimersByTimeAsync(34000));
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ x: 25, y: 0 }));
  expect(screen.getByTestId("figure")).toHaveTextContent("roam");
});

function pointerAt(target: Element, x: number, y: number) {
  fireEvent(
    target,
    new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }),
  );
}
function contactAt(target: Element, x: number, y: number) {
  state.pixelHit = true;
  state.opaqueContact = { x, y };
  pointerAt(target, x, y);
  state.pixelHit = false;
}
function hoverRects(view: ReturnType<typeof render>, above = false) {
  const character = view.container.querySelector(".pet-runtime-character")!;
  vi.spyOn(character, "getBoundingClientRect").mockReturnValue({
    left: 67.5,
    right: 232.5,
    top: 128,
    bottom: 348,
    width: 165,
    height: 220,
    x: 67.5,
    y: 128,
  } as DOMRect);
  const tray = view.container.querySelector(".pet-runtime-actions");
  if (tray)
    vi.spyOn(tray, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: above ? 45 : 325,
      width: 60,
      height: 30,
    } as DOMRect);
  return view.container.firstElementChild!;
}

test.each([120, 200])(
  "visible pixels to an internal transparent head/body point at y=%s closes native interaction",
  async (y) => {
    const view = await mount();
    const host = hoverRects(view);
    contactAt(host, 150, 210);
    expect(interactiveBridge).toHaveBeenLastCalledWith(true);
    expect(state.geometry).not.toHaveBeenCalled(); // An actual hit does not need bounds readback.
    state.pixelHit = false;
    pointerAt(host, 150, y);
    expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
    expect(view.container.querySelector(".pet-runtime-actions")).toBeNull();
    view.unmount();
  },
);

test.each([false, true])(
  "the displayed action tray's short %s gap stays reachable without extending through the window",
  async (above) => {
    const view = await mount();
    const host = hoverRects(view, above);
    contactAt(host, 150, above ? 102 : 298);
    pointerAt(host, 150, above ? 85 : 310);
    expect(interactiveBridge.mock.calls).toEqual([[true]]);
    expect(state.geometry).toHaveBeenCalledTimes(1);
    pointerAt(host, 150, above ? 5 : 395);
    expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
    view.unmount();
  },
);

test("current geometry changes and failed measurement cannot retain a stale action gap", async () => {
  const view = await mount();
  const host = hoverRects(view);
  contactAt(host, 150, 298);
  pointerAt(host, 150, 310);
  state.geometry.mockReturnValue({
    visible: { x: 100, y: 100, width: 100, height: 220 },
    feet: { x: 150, y: 320 },
  });
  pointerAt(host, 150, 310);
  expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
  state.pixelHit = true;
  pointerAt(host, 150, 200);
  hoverRects(view);
  state.pixelHit = false;
  state.geometry.mockImplementationOnce(() => {
    throw new Error("readback failed");
  });
  expect(() => pointerAt(host, 150, 310)).not.toThrow();
  expect(interactiveBridge).toHaveBeenLastCalledWith(false);
  view.unmount();
});

test("no displayed tray creates no route and forwarded moves can re-enter actual pixels", async () => {
  state.hoverActions = [];
  const view = await mount();
  const host = hoverRects(view);
  state.pixelHit = false;
  pointerAt(host, 150, 310);
  expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
  expect(state.geometry).not.toHaveBeenCalled();
  state.pixelHit = true;
  pointerAt(host, 150, 200);
  expect(interactiveBridge.mock.calls).toEqual([[true], [false], [true]]);
  view.unmount();
});

test("legacy renderers without geometry retain actual alpha hits and button/status admission", async () => {
  state.legacyHuman = true;
  state.geometryAvailable = false;
  const view = await mount();
  const host = hoverRects(view);
  state.pixelHit = false;
  const button = screen.getByRole("button", { name: "走动：多待着" });
  pointerAt(button, 150, 335);
  expect(state.geometry).not.toHaveBeenCalled();
  expect(interactiveBridge.mock.calls).toEqual([[true]]);
  pointerAt(host, 150, 310);
  expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
  pointerAt(view.container.querySelector(".pet-runtime-status")!, 260, 20);
  expect(interactiveBridge.mock.calls).toEqual([[true], [false], [true]]);
  expect(screen.getByRole("button", { name: "走动：多待着" })).toBeTruthy();
  view.unmount();
});

// Native v4 upper-route failure: public visible.y=232.391965..., actual tray
// bottom=226.3984375. Root observed alpha228 at (223.791,235.75), then alpha14
// after a 0.98 DIP upward step. These are controlled admission proxies, not PNG pixels.
test("continuous sub-DIP moves cross a tilted crown's inner transparent contour to the upper button", async () => {
  const view = await mount();
  const host = hoverRects(view);
  const tray = view.container.querySelector(".pet-runtime-actions")!;
  vi.spyOn(tray, "getBoundingClientRect").mockReturnValue({
    x: 82.5,
    y: 196.3984375,
    width: 135,
    height: 30,
  } as DOMRect);
  state.geometry.mockReturnValue({
    visible: {
      x: 157.57389870535587,
      y: 232.39196525359998,
      width: 122.7558321571118,
      height: 130.93955430091924,
    },
    feet: { x: 200, y: 363.33 },
  });
  contactAt(host, 223.791, 235.75);
  pointerAt(host, 223.791, 234.77); // Still inside bbox, but current alpha proxy=14.
  expect(interactiveBridge.mock.calls).toEqual([[true]]);
  expect(state.geometry).toHaveBeenCalledTimes(1);
  // A small coarse-bbox fluctuation keeps a still-valid contact/path usable.
  state.geometry.mockReturnValue({
    visible: {
      x: 157.57389870535587,
      y: 232.89196525359998,
      width: 122.7558321571118,
      height: 130.43955430091924,
    },
    feet: { x: 200, y: 363.33 },
  });
  pointerAt(host, 223.791, 234.77);
  expect(interactiveBridge.mock.calls).toEqual([[true]]);
  const target = { x: 202.5, y: 211.3984375 },
    start = { x: 223.791, y: 234.77 };
  const steps = Math.ceil(
    Math.max(Math.abs(target.x - start.x), Math.abs(target.y - start.y)) / 0.98,
  );
  for (let i = 1; i <= steps; i++) {
    pointerAt(
      host,
      start.x + ((target.x - start.x) * i) / steps,
      start.y + ((target.y - start.y) * i) / steps,
    );
    expect(interactiveBridge.mock.calls).toEqual([[true]]);
    expect(view.container.querySelector(".pet-runtime-actions")).toBeTruthy();
  }
  const button = screen.getByRole("button", { name: "走动：多待着" });
  pointerAt(button, target.x, target.y);
  expect(state.geometry).toHaveBeenCalledTimes(2); // Once in the actual tray, no geometry readback.
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: "走动：常走动" })).toBeTruthy();
  view.unmount();
});

test.each(["pose-alpha", "moved-geometry"])(
  "a stale confirmed contact after %s cannot authorize an old route",
  async (reason) => {
    const view = await mount();
    const host = hoverRects(view);
    contactAt(host, 150, 298);
    pointerAt(host, 150, 310);
    expect(interactiveBridge.mock.calls).toEqual([[true]]);
    if (reason === "pose-alpha") state.opaqueContact = null;
    else
      state.geometry.mockReturnValue({
        visible: { x: 300, y: 100, width: 100, height: 200 },
        feet: { x: 350, y: 300 },
      });
    pointerAt(host, 150, 310);
    expect(interactiveBridge.mock.calls).toEqual([[true], [false]]);
    state.opaqueContact = { x: 150, y: 298 };
    pointerAt(host, 150, 310);
    expect(interactiveBridge.mock.calls).toEqual([[true], [false]]); // A miss cannot revive a cleared contact.
    view.unmount();
  },
);

test("the actual whole tray stays active through every 0.5-DIP step across its 5px button gap without geometry", async () => {
  state.hoverActions = ["roam", "chat"];
  state.geometryAvailable = false;
  const view = await mount();
  const host = hoverRects(view);
  const tray = view.container.querySelector(".pet-runtime-actions")!;
  vi.spyOn(tray, "getBoundingClientRect").mockReturnValue({
    x: 120,
    y: 325,
    width: 65,
    height: 30,
  } as DOMRect);
  state.pixelHit = false;
  const button1 = screen.getByRole("button", { name: "走动：多待着" });
  const button2 = screen.getByRole("button", { name: "聊天" });
  pointerAt(button1, 135, 340);
  for (let x = 135.5; x <= 170; x += 0.5) {
    pointerAt(host, x, 340); // Includes all five transparent px between the actual buttons.
    expect(interactiveBridge.mock.calls).toEqual([[true]]);
  }
  pointerAt(button2, 170, 340);
  expect(state.geometry).not.toHaveBeenCalled();
  view.unmount();
});
