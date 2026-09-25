import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterDocument } from "../src/shared/live2d/types";

const control = vi.hoisted(() => ({ fail: false, renders: 0, updates: 0 }));

vi.mock("pixi.js", () => ({
  Application: class {
    canvas = globalThis.document.createElement("canvas");
    renderer = {};
    ticker = { stop: () => undefined };
    stage = { addChild: () => undefined };
    async init() {
      if (control.fail) throw new Error("WebGL unavailable");
    }
    render() {
      control.renders += 1;
    }
    destroy() {
      return undefined;
    }
  },
  Assets: { load: async () => ({}) },
}));

vi.mock("../src/shared/live2d/mesh", () => ({
  createPoseMeshes: () => ({
    container: { scale: { set: () => undefined } },
    update: () => {
      control.updates += 1;
    },
  }),
}));

const archive = unzipSync(
  readFileSync(resolve(__dirname, "../public/brand/amadeus/amadeus.fpllive2d")),
);
const model = (
  JSON.parse(strFromU8(archive["manifest.json"])) as {
    document: CharacterDocument;
  }
).document;
vi.mock("../src/features/amadeus/avatarModel", () => ({
  loadAmadeusModel: async () => ({ document: model, urls: new Map() }),
  boundPose: (
    document: CharacterDocument,
    state: keyof CharacterDocument["stateBindings"],
  ) => {
    const binding = document.stateBindings[state];
    return {
      motion: document.motions.find((motion) => motion.id === binding.motionId),
      expressionId: binding.expressionId,
    };
  },
}));

import { AmadeusAvatar } from "../src/features/amadeus/Avatar";

describe("Amadeus runtime avatar", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    control.fail = false;
    control.renders = 0;
    control.updates = 0;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders one representative pose per state with reduced motion", async () => {
    const view = render(<AmadeusAvatar state="idle" />);
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()!(100));
    expect(control.renders).toBe(1);
    act(() => frames.shift()!(200));
    expect(control.renders).toBe(1);
    view.rerender(<AmadeusAvatar state="success" />);
    act(() => frames.shift()!(300));
    expect(control.renders).toBe(2);
    expect(view.getByRole("img", { name: "Amadeus：已完成" })).toHaveAttribute(
      "data-avatar-renderer",
      "model",
    );
  });

  it("keeps the same model poster visible when WebGL fails", async () => {
    control.fail = true;
    const view = render(<AmadeusAvatar state="error" />);
    await waitFor(() =>
      expect(
        view.getByRole("img", { name: "Amadeus：需要关注" }),
      ).toHaveAttribute("data-avatar-renderer", "poster"),
    );
    expect(
      view.container.querySelector(".amadeus-avatar-poster"),
    ).toHaveAttribute("src", "/brand/amadeus/amadeus-poster.png");
  });

  it("pauses rendering while the page is hidden", async () => {
    let hidden = true;
    const hiddenSpy = vi
      .spyOn(document, "hidden", "get")
      .mockImplementation(() => hidden);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<AmadeusAvatar state="thinking" />);
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()!(100));
    expect(control.renders).toBe(0);
    hidden = false;
    act(() => frames.shift()!(200));
    expect(control.renders).toBe(1);
    hiddenSpy.mockRestore();
  });
});
