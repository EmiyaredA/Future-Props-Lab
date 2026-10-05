import { forwardRef, useImperativeHandle, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { EditorStage } from "@features/desktop-pet/EditorStage";
import {
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
