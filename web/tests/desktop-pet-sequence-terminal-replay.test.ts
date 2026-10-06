import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const cel = (texture: string): SequenceFrame => ({
  texture,
  rect: [0, 0, 100, 200],
  durationMs: 100,
  grip: [50, 70],
  foot: [50, 190],
  head: [
    [50, 10],
    [50, 50],
  ],
});
const fixture = (branched: boolean): FrameSequences => {
  const idle = cel("idle"),
    pose = cel("held-pose");
  return {
    version: 1,
    frameSize: [100, 200],
    modelBox: [20, 30, 50, 100],
    headLength: 20,
    clips: {
      idle: { loop: true, frames: [idle] },
      held: { loop: false, frames: [idle, pose] },
      look: { loop: false, frames: [idle, cel("look-a"), cel("look-b")] },
      pickup: { loop: false, frames: [idle] },
      exit: {
        loop: false,
        frames: branched
          ? [cel("unused"), idle, idle, pose, idle, cel("unused")]
          : [pose, idle],
      },
      entry: {
        loop: false,
        frames: branched
          ? [cel("unused"), idle, cel("fresh-entry"), idle, cel("unused")]
          : [idle, cel("fresh-entry"), idle],
      },
    },
    transitions: [
      { id: "pickup", from: "idle", to: "held", clip: "pickup" },
      {
        id: "release",
        from: "held",
        to: "idle",
        clip: "exit",
        ...(branched
          ? {
              branches: [
                { fromFrame: 0, clip: "exit", range: [1, 3] },
                { fromFrame: 1, clip: "exit", range: [3, 5] },
              ],
            }
          : {}),
      },
      {
        id: "replay",
        from: "idle",
        to: "look",
        clip: "entry",
        ...(branched
          ? {
              branches: [{ fromFrame: 0, clip: "entry", range: [1, 4] }],
            }
          : {}),
      },
    ],
  };
};

let requests: string[];
let entryDecode: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};
class TestImage {
  src = "";
  naturalWidth = 100;
  naturalHeight = 200;
  async decode() {
    requests.push(this.src);
    if (this.src.endsWith("fresh-entry.png")) await entryDecode.promise;
  }
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  requests = [];
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  entryDecode = { promise, resolve, reject };
  vi.stubGlobal("Image", TestImage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function harness(branched: boolean) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage,
      clearRect: vi.fn(),
    })) as unknown as HTMLCanvasElement["getContext"],
  );
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    scheme: "classic",
    motionFacing: () => 1,
    reset: () => undefined,
    preload: async () => undefined,
    setScheme: async () => undefined,
    draw: (group) => {
      if (!group.firstChild) group.append(document.createElement("canvas"));
    },
  };
  const figure = createSequenceFigure({
    base,
    sequences: fixture(branched),
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => `/authorized/${path}`,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  let t = 0;
  const tick = async (mode: string) => {
    const frame: WhaleFrame = {
      t: (t += 0.02),
      mode,
      swing: 0,
      sit: 0,
      look: [0, 0],
      legs: [],
    };
    figure.draw(group, { eyes: [], gap: [] }, frame);
    await settle();
  };
  const latest = () =>
    (drawImage.mock.calls.at(-1)?.[0] as TestImage | undefined)?.src
      .split("/")
      .at(-1)
      ?.replace(".png", "");
  const until = async (mode: string, ready: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      await tick(mode);
      if (ready()) return;
    }
    throw new Error(`No actual ${mode} paint at requested stage`);
  };
  const box = () => {
    const object = group.querySelector("foreignObject")!;
    return ["x", "y", "width", "height"].map((key) => object.getAttribute(key));
  };
  const exitTerminal = async () => {
    await until("idle", () => latest() === "idle");
    await until("held", () => latest() === "held-pose");
    await until("idle", () => latest() === "idle");
    expect(figure.getMotionTransition?.()).toMatchObject({ id: "release" });
    expect(figure.getMotionTransition?.()?.progress).toBeGreaterThanOrEqual(
      0.5,
    );
    expect(figure.getMotionTransition?.()?.progress).toBeLessThan(1);
    expect(figure.getMotionFailure?.()).toBeNull();
  };
  return { figure, group, tick, until, latest, box, exitTerminal, drawImage };
}

describe("actual terminal bridge Canvas replay", () => {
  it.each([false, true])(
    "decodes and paints the next entry before advancing, nonzero branch=%s",
    async (branched) => {
      const h = harness(branched);
      try {
        await h.exitTerminal();
        expect(requests.some((path) => path.endsWith("fresh-entry.png"))).toBe(
          false,
        );
        const oldBox = h.box(),
          count = h.drawImage.mock.calls.length;
        h.figure.acceptReactionPlayback?.();
        await h.tick("look");
        expect(
          requests.filter((path) => path.endsWith("fresh-entry.png")),
        ).toHaveLength(1);
        for (let i = 0; i < 20; i++) await h.tick("look");
        expect(h.latest()).toBe("idle");
        expect(h.drawImage).toHaveBeenCalledTimes(count);
        expect(h.box()).toEqual(oldBox);
        expect(h.figure.getMotionTransition?.()?.id).toContain(
          "sequence-assets",
        );
        entryDecode.resolve();
        await settle();
        await h.until("look", () => h.latest() === "fresh-entry");
        expect(h.figure.getMotionTransition?.()).toMatchObject({
          id: "replay",
        });
        await h.until("look", () => h.latest() === "look-b");
        const paints = h.drawImage.mock.calls
          .slice(count)
          .map((call) =>
            (call[0] as TestImage).src.split("/").at(-1)?.replace(".png", ""),
          );
        expect(paints).toEqual(["fresh-entry", "idle", "look-a", "look-b"]);
        expect(requests.some((path) => path.endsWith("unused.png"))).toBe(
          false,
        );
        expect(h.figure.getMotionFailure?.()).toBeNull();
        expect(
          h.group.querySelector('canvas[data-pet-raster-active="true"]'),
        ).not.toBeNull();
      } finally {
        h.figure.dispose?.();
      }
    },
  );

  it("retains the installed terminal cel when the new entry cannot decode", async () => {
    const h = harness(true);
    try {
      await h.exitTerminal();
      const count = h.drawImage.mock.calls.length,
        oldBox = h.box();
      h.figure.acceptReactionPlayback?.();
      await h.tick("look");
      entryDecode.reject(new Error("new-entry-decode-failed"));
      await settle();
      for (let i = 0; i < 40; i++) await h.tick("look");
      expect(h.figure.getAssetFailure?.()).toBe("new-entry-decode-failed");
      expect(h.figure.getMotionTransition?.()).toBeNull();
      expect(h.latest()).toBe("idle");
      expect(h.drawImage).toHaveBeenCalledTimes(count);
      expect(h.box()).toEqual(oldBox);
      expect(
        requests.filter((path) => path.endsWith("fresh-entry.png")),
      ).toHaveLength(1);
    } finally {
      h.figure.dispose?.();
    }
  });
});
