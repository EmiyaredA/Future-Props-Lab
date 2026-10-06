import { forwardRef, useImperativeHandle, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { EditorStage } from "@features/desktop-pet/EditorStage";
import {
  actionTrayHit,
  actionTrayPath,
  headHitRegion,
  reactionForHit,
} from "@features/desktop-pet/interaction";

const state = vi.hoisted(() => ({
  ready: true,
  region: null as "head" | "body" | null | undefined,
  classify: vi.fn(),
}));
vi.mock("@features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: forwardRef(function Figure(_props, ref) {
    useImperativeHandle(ref, () =>
      state.ready
        ? {
            classifyHit: (x: number, y: number) => {
              state.classify(x, y);
              return state.region;
            },
          }
        : null,
    );
    return <div>painted figure</div>;
  }),
}));
beforeEach(() => {
  state.ready = true;
  state.region = null;
  state.classify.mockReset();
});

function stage() {
  const play = vi.fn();
  const props: ComponentProps<typeof EditorStage> = {
    document: {
      revision: 0,
      sourceType: "coopanion-whale",
      sourceRevision: 1,
      character: null,
      whaleModel: { schemes: [{ id: "classic" }] },
      whaleAssets: {},
      assetUrls: {},
      config: {
        schemaVersion: 2,
        skins: [],
        activeSkinId: null,
        events: {},
        habits: {
          size: 220,
          roam: "off",
          bubbles: false,
          draggable: true,
          edgeClimbing: true,
          highGliding: true,
          sound: false,
        },
      },
    },
    tab: "preview",
    skinId: null,
    figureName: "test",
    preview: {
      eventName: "idle",
      mode: "runtime",
      key: 0,
      line: 0,
      demo: null,
      motionDemo: null,
      bubble: "",
      play,
      inspect: vi.fn(),
      playSelected: vi.fn(),
      demonstrate: vi.fn(),
      selectLine: vi.fn(),
    },
    link: {
      available: false,
      enabled: false,
      message: "test",
      toggle: async () => {},
    },
  };
  render(<EditorStage {...props} />);
  const button = screen.getByRole("button", { name: "触摸桌宠，试听反应" });
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 220,
  } as DOMRect);
  return { button, play };
}

test.each(["head", "body", null, undefined] as const)(
  "editor pointer clicks respect authoritative %s and legacy fallback",
  (region) => {
    state.region = region;
    const { button, play } = stage();
    fireEvent.click(button, { detail: 1, clientX: 223, clientY: 242 });
    expect(state.classify).toHaveBeenCalledWith(223, 242);
    if (region === null) expect(play).not.toHaveBeenCalled();
    else expect(play).toHaveBeenCalledWith(region === "head" ? "pet" : "click");
  },
);

test("a renderer not ready rejects pointer input while the keyboard audition remains reachable", () => {
  state.ready = false;
  const { button, play } = stage();
  fireEvent.click(button, { detail: 1, clientY: 110 });
  expect(play).not.toHaveBeenCalled();
  fireEvent.click(button, { detail: 0, clientY: 0 });
  expect(play).toHaveBeenCalledExactlyOnceWith("pet");
  expect(state.classify).not.toHaveBeenCalled();
});

test("unsupported Live2D/base classification retains both former host bands", () => {
  expect(reactionForHit(undefined, 110, { top: 100, height: 220 })).toBe("pet");
  expect(reactionForHit(undefined, 242, { top: 100, height: 220 })).toBe(
    "click",
  );
  expect(reactionForHit(null, 110, { top: 100, height: 220 })).toBeNull();
});

test("finite cranial hotspot rotates with its painted axis and excludes trailing points", () => {
  expect(
    headHitRegion({ x: 100, y: 50 }, [
      [0, 0],
      [100, 100],
    ]),
  ).toBe("head");
  expect(
    headHitRegion({ x: 200, y: 200 }, [
      [0, 0],
      [100, 100],
    ]),
  ).toBe("body");
  expect(
    headHitRegion({ x: 0, y: 0 }, [
      [0, 0],
      [0, 0],
    ]),
  ).toBe("body");
  expect(
    headHitRegion({ x: NaN, y: 0 }, [
      [0, 0],
      [100, 100],
    ]),
  ).toBe("body");
});

const visible = { x: 100, y: 100, width: 100, height: 200 };
const below = { x: 120, y: 325, width: 60, height: 30 };
const above = { ...below, y: 45 };
const edgeContact = { x: 150, y: 298 };

test.each([above, below])(
  "the short action corridor respects the actual tray %j and excludes all body interior holes",
  (tray) => {
    const gapY = tray.y < visible.y ? 85 : 310;
    const contact = { x: 150, y: tray.y < visible.y ? 102 : 298 };
    expect(
      actionTrayPath({ x: 150, y: gapY }, visible, tray, true, contact),
    ).toBe(true);
    expect(
      actionTrayPath({ x: 110, y: gapY }, visible, tray, true, contact),
    ).toBe(false);
    expect(
      actionTrayPath({ x: 150, y: 200 }, visible, tray, true, contact),
    ).toBe(false);
    expect(
      actionTrayPath({ x: 150, y: 120 }, visible, tray, true, contact),
    ).toBe(false);
    expect(
      actionTrayPath({ x: 150, y: 395 }, visible, tray, true, contact),
    ).toBe(false);
  },
);

test("missing, invalid, hidden, overlapping or horizontally separated geometry creates no hover corridor", () => {
  const p = { x: 150, y: 310 };
  expect(actionTrayPath(p, visible, below, false, edgeContact)).toBe(false);
  expect(actionTrayPath(p, null, below, true, edgeContact)).toBe(false);
  expect(actionTrayPath(p, visible, null, true, edgeContact)).toBe(false);
  for (const rect of [
    { ...visible, width: 0 },
    { ...visible, height: -1 },
    { ...visible, x: NaN },
    { ...visible, y: Infinity },
  ])
    expect(actionTrayPath(p, rect, below, true, edgeContact)).toBe(false);
  expect(
    actionTrayPath({ x: NaN, y: 310 }, visible, below, true, edgeContact),
  ).toBe(false);
  expect(
    actionTrayPath(p, visible, { ...below, x: 205 }, true, edgeContact),
  ).toBe(false);
  expect(
    actionTrayPath(p, visible, { ...below, y: 295 }, true, edgeContact),
  ).toBe(false);
  expect(
    actionTrayPath(p, visible, { ...below, y: 395 }, true, edgeContact),
  ).toBe(false);
  expect(
    actionTrayPath(p, visible, { ...below, y: 394 }, true, edgeContact),
  ).toBe(true);
});

test("changed visible geometry immediately invalidates the old gap without stored rectangles", () => {
  const p = { x: 150, y: 310 };
  expect(actionTrayPath(p, visible, below, true, edgeContact)).toBe(true);
  expect(
    actionTrayPath(p, { ...visible, height: 220 }, below, true, edgeContact),
  ).toBe(false);
  expect(
    actionTrayPath(p, { ...visible, x: 300 }, below, true, edgeContact),
  ).toBe(false);
});

test("only a confirmed pixel near the current edge authorizes its narrow inner contour gap", () => {
  expect(actionTrayPath({ x: 150, y: 99 }, visible, above, true, null)).toBe(
    false,
  );
  expect(
    actionTrayPath({ x: 150, y: 101 }, visible, above, true, {
      x: 150,
      y: 103,
    }),
  ).toBe(true);
  expect(
    actionTrayPath({ x: 159, y: 101 }, visible, above, true, {
      x: 150,
      y: 103,
    }),
  ).toBe(false);
  expect(
    actionTrayPath({ x: 150, y: 101 }, visible, above, true, {
      x: 150,
      y: 109,
    }),
  ).toBe(false);
  expect(
    actionTrayPath({ x: 150, y: 120 }, visible, above, true, {
      x: 150,
      y: 103,
    }),
  ).toBe(false);
  // Quantized geometry can slightly under-bound a real opaque contact.
  expect(
    actionTrayPath({ x: 150, y: 95 }, visible, above, true, { x: 150, y: 98 }),
  ).toBe(true);
});

test("the actual displayed tray admits all button gaps and modest padding without geometry", () => {
  expect(actionTrayHit({ x: 130, y: 335 }, below, true)).toBe(true);
  expect(actionTrayHit({ x: 175, y: 335 }, below, true)).toBe(true);
  expect(actionTrayHit({ x: 150, y: 317 }, below, true)).toBe(true);
  expect(actionTrayHit({ x: 150, y: 316 }, below, true)).toBe(false);
  expect(actionTrayHit({ x: 150, y: 335 }, below, false)).toBe(false);
  expect(actionTrayHit({ x: 150, y: 335 }, null, true)).toBe(false);
  expect(actionTrayHit({ x: NaN, y: 335 }, below, true)).toBe(false);
  expect(actionTrayHit({ x: 150, y: 335 }, { ...below, width: 0 }, true)).toBe(
    false,
  );
});
