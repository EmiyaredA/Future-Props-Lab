import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PetDocument } from "../src/features/desktop-pet/api";
import type { HumanModel } from "../src/features/desktop-pet/humanFigure";
import { WhaleRenderer } from "../src/features/desktop-pet/WhaleRenderer";

// Keep the real renderer -> human figure -> rig -> sequence wrapper chain.
// Only browser Image/Canvas/GL boundaries are controlled; counts describe
// explicit ownership cleanup, not native GPU residency or browser GC.
function browserSurfaces() {
  const contexts: { releases: number; uploads: number }[] = [];
  const pending: { url: string; finish: () => void }[] = [];
  const paused = new Set<string>();
  let wrapperAttempts = 0;
  let failWrapper = true;
  class Image {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 200;
    naturalWidth = 100;
    naturalHeight = 200;
    private url = "";
    set src(url: string) {
      this.url = url;
      const finish = () => this.onload?.();
      if ([...paused].some((part) => url.includes(part)))
        pending.push({ url, finish });
      else queueMicrotask(finish);
    }
    get src() {
      return this.url;
    }
    async decode() {}
  }
  vi.stubGlobal("Image", Image);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d") {
        if (this.width === 100 && this.height === 200) {
          wrapperAttempts++;
          if (failWrapper) return null;
        }
        return new Proxy({}, { get: () => vi.fn() });
      }
      const context = { releases: 0, uploads: 0 };
      contexts.push(context);
      return new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "canvas") return this;
            if (key === "getExtension")
              return () => ({ loseContext: () => context.releases++ });
            if (key === "texImage2D") return () => context.uploads++;
            if (key === "getShaderParameter" || key === "getProgramParameter")
              return () => true;
            return vi.fn(() => ({}));
          },
        },
      );
    } as unknown as HTMLCanvasElement["getContext"],
  );
  return {
    contexts,
    pending,
    paused,
    attempts: () => wrapperAttempts,
    allowWrapper: () => (failWrapper = false),
    rejectWrapper: () => (failWrapper = true),
    finish(part: string) {
      paused.delete(part);
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].url.includes(part)) pending.splice(i, 1)[0].finish();
    },
  };
}

const model: HumanModel = {
  rigProfile: "human-chibi",
  character: { name: "wrapper ownership fixture" },
  view: [0, 0, 100, 100],
  pivots: Object.fromEntries(
    ["body", "neck", "armNear", "armFar", "legBack", "legFront"].map((id) => [
      id,
      [50, 50],
    ]),
  ),
  parts: ["hair_back", "hair_front", "coat"].map((id, i) => ({
    id,
    tex: "atlas",
    parent: "body",
    box: [i * 10, 0, 10, 20],
    grid: [1, 1],
    uvBox: [i / 4, 0, (i + 1) / 4, 1],
    z: i,
  })),
  feat: { sprites: { eyes: [10, 10, 20, 20] } },
  schemes: [{ id: "classic" }],
};

function document(revision = 1): PetDocument {
  return {
    revision,
    sourceRevision: revision,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      ...model,
      frameSequences: {
        version: 1,
        frameSize: [100, 200],
        modelBox: [0, 0, 50, 100],
        headLength: 20,
        clips: {
          idle: {
            loop: true,
            frames: [
              {
                texture: "whole",
                rect: [0, 0, 100, 200],
                durationMs: 400,
                grip: [50, 70],
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
      },
    },
    whaleAssets: {
      "tex/atlas.png": "atlas",
      "feat/eyes.png": "eyes",
      "tex/whole.png": "whole",
    },
    assetUrls: Object.fromEntries(
      ["atlas", "eyes", "whole"].map((id) => [
        id,
        `/revision-${revision}/${id}`,
      ]),
    ),
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      schemeId: "classic",
      events: { idle: { motionId: null, expressionId: null, sound: "none" } },
      habits: {
        size: 220,
        roam: "off",
        draggable: true,
        edgeClimbing: true,
        highGliding: true,
        sound: false,
        bubbles: false,
        hoverActions: [],
      },
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("repeated wrapper construction failures release each already uploaded real base and preserve the actual error", async () => {
  const surface = browserSurfaces();
  for (let i = 0; i < 3; i++) {
    const view = render(<WhaleRenderer document={document(i + 1)} />);
    await waitFor(() =>
      expect(view.getByRole("alert")).toHaveTextContent("完整序列帧画布不可用"),
    );
    expect(surface.contexts).toHaveLength(i + 1);
    expect(surface.contexts.every((ctx) => ctx.uploads === 1)).toBe(true);
    expect(surface.contexts.every((ctx) => ctx.releases === 1)).toBe(true);
    view.unmount();
    expect(surface.contexts.every((ctx) => ctx.releases === 1)).toBe(true);
  }
});

test("a successful wrapper exclusively owns its real base until normal unmount", async () => {
  const surface = browserSurfaces();
  surface.allowWrapper();
  const view = render(<WhaleRenderer document={document()} />);
  await waitFor(() => expect(surface.attempts()).toBe(1));
  expect(view.queryByRole("alert")).toBeNull();
  expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([0]);
  view.unmount();
  expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([1]);
});

test.each([false, true])(
  "late initialization after unmount cleans the real base, wrapper failure=%s",
  async (fail) => {
    const surface = browserSurfaces();
    if (!fail) surface.allowWrapper();
    surface.paused.add("revision-1");
    const view = render(<WhaleRenderer document={document()} />);
    expect(surface.pending).toHaveLength(2);
    view.unmount();
    await act(async () => surface.finish("revision-1"));
    await waitFor(() => expect(surface.attempts()).toBe(1));
    expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([1]);
  },
);

test("an old revision failing late cannot pollute or dispose the newer successful instance", async () => {
  const surface = browserSurfaces();
  surface.paused.add("revision-1");
  const view = render(<WhaleRenderer document={document()} />);
  surface.allowWrapper();
  view.rerender(<WhaleRenderer document={document(2)} />);
  await waitFor(() => expect(surface.attempts()).toBe(1));
  surface.rejectWrapper();
  await act(async () => surface.finish("revision-1"));
  await waitFor(() => expect(surface.attempts()).toBe(2));
  expect(view.queryByRole("alert")).toBeNull();
  expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([0, 1]);
  view.unmount();
  expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([1, 1]);
});

test.each([false, true])(
  "StrictMode duplicate initialization transfers/releases each real base exactly once, failure=%s",
  async (fail) => {
    const surface = browserSurfaces();
    if (!fail) surface.allowWrapper();
    const view = render(
      <StrictMode>
        <WhaleRenderer document={document()} />
      </StrictMode>,
    );
    await waitFor(() => expect(surface.attempts()).toBe(2));
    if (fail)
      expect(view.getByRole("alert")).toHaveTextContent("完整序列帧画布不可用");
    else expect(view.queryByRole("alert")).toBeNull();
    expect(surface.attempts()).toBe(2);
    expect(surface.contexts.map((ctx) => ctx.releases)).toEqual(
      fail ? [1, 1] : [1, 0],
    );
    view.unmount();
    expect(surface.contexts.map((ctx) => ctx.releases)).toEqual([1, 1]);
  },
);
