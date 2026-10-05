import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import characterFixture from "../../tests/fixtures/live2d-evaluation.json";
import type { PetDocument, PetReaction } from "../src/features/desktop-pet/api";
import type { CharacterDocument } from "../src/shared/live2d/types";
import type {
  PetPreviewDelivery,
  PetPreviewDraft,
} from "../src/platform/petPreview";
import {
  usePetPreview,
  validatePreview,
} from "../src/features/desktop-pet/usePetPreview";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/features/desktop-pet/api", () => ({ getDocument: api.get }));

function reaction(expressionId: string | null = null): PetReaction {
  return { motionId: null, expressionId, lines: ["保留台词"], sound: "none" };
}
function document(): PetDocument {
  const cel = {
    texture: "atlas",
    rect: [0, 0, 16, 16],
    durationMs: 40,
    grip: [8, 8],
    foot: [8, 16],
    head: [
      [8, 0],
      [8, 6],
    ],
  };
  const held = { ...cel, rect: [16, 0, 16, 16] };
  return {
    revision: 8,
    sourceRevision: 1,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      rigProfile: "human-chibi",
      schemes: [{ id: "classic" }],
      frameSequences: {
        version: 1,
        frameSize: [16, 16],
        modelBox: [0, 0, 16, 16],
        headLength: 6,
        clips: {
          idle: { frames: [cel], loop: true },
          held: { frames: [held], loop: true },
          hold_entry: { frames: [cel, held], loop: false },
          hold_exit: { frames: [held, cel], loop: false },
        },
        transitions: [
          { id: "grab", from: "idle", to: "held", clip: "hold_entry" },
          { id: "drop", from: "held", to: "idle", clip: "hold_exit" },
        ],
      },
    },
    whaleAssets: {},
    assetUrls: {},
    config: {
      schemaVersion: 2,
      schemeId: "classic",
      skins: [],
      events: {
        idle: reaction(),
        click: { ...reaction("surprised"), motionId: "hop" },
        pet: reaction("happy"),
      },
    },
  };
}
function draft(base: PetDocument): PetPreviewDraft {
  return {
    projectId: "pet",
    sessionId: "lease",
    baseRevision: base.revision,
    sequence: 1,
    config: structuredClone(base.config),
    skinId: "classic",
    eventName: "idle",
    mode: "inspect",
    key: 1,
    line: 0,
  };
}

test.each(["inspect", "runtime", "event"] as const)(
  "%s idle preserves inactive known but unavailable reactions",
  (mode) => {
    const base = document();
    const original = structuredClone(base);
    const value = { ...draft(base), mode };
    const merged = validatePreview(base, value);
    expect(merged.config.events?.click).toEqual(base.config.events?.click);
    expect(merged.config.events?.pet).toEqual(base.config.events?.pet);
    expect(base).toEqual(original);
    expect(value.config).toEqual(original.config);
  },
);

test.each(["inspect", "runtime", "event"] as const)(
  "%s checks the requested reaction rather than assuming runtime means idle",
  (mode) => {
    const base = document();
    const value = draft(base);
    value.config.events!.click!.motionId = null;
    expect(() =>
      validatePreview(base, { ...value, mode, eventName: "click" }),
    ).toThrow("不支持该预览表情");
  },
);

test.each([null, "neutral"])("%s restores the natural expression", (id) => {
  const base = document();
  const value = draft(base);
  value.config.events!.idle!.expressionId = id;
  expect(validatePreview(base, value).config.events?.idle?.expressionId).toBe(
    id,
  );
});

test.each(["expressionId", "motionId"] as const)(
  "unknown inactive %s remains invalid",
  (field) => {
    const base = document();
    const value = draft(base);
    value.config.events!.pet![field] = "foreign";
    expect(() => validatePreview(base, value)).toThrow("不存在");
  },
);

test.each(["expressionId", "motionId"] as const)(
  "an empty inactive %s is not a valid natural-effect ID",
  (field) => {
    const base = document();
    const value = draft(base);
    value.config.events!.pet![field] = "";
    expect(() => validatePreview(base, value)).toThrow("不存在");
  },
);

test("unknown motion demo cannot bypass ID validation for a legacy resource", () => {
  const base = document();
  base.whaleModel = { schemes: [{ id: "classic" }] };
  const value = {
    ...draft(base),
    motionDemo: "foreign",
  } as unknown as PetPreviewDraft;
  expect(() => validatePreview(base, value)).toThrow("运动姿态不存在");
});

test("current known but unavailable motion is rejected, without clearing historical config", () => {
  const base = document();
  const value = draft(base);
  value.config.events!.click!.expressionId = null;
  expect(() => validatePreview(base, { ...value, eventName: "click" })).toThrow(
    "不支持该预览动作",
  );
  expect(base.config.events?.click?.motionId).toBe("hop");
});

test("a valid motion demo owns motion, while the independent selected expression is checked", () => {
  const base = document();
  const value = draft(base);
  value.config.events!.idle!.motionId = "hop";
  expect(
    validatePreview(base, { ...value, motionDemo: "held" }).config.events,
  ).toEqual(value.config.events);
  value.config.events!.idle!.expressionId = "surprised";
  expect(() => validatePreview(base, { ...value, motionDemo: "held" })).toThrow(
    "不支持该预览表情",
  );
});

test("unavailable demo and unknown inactive IDs are not bypassed by demo priority", () => {
  const base = document();
  expect(() =>
    validatePreview(base, { ...draft(base), motionDemo: "walk-right" }),
  ).toThrow("完整序列帧");
  const value = draft(base);
  value.config.events!.click!.motionId = "foreign";
  expect(() => validatePreview(base, { ...value, motionDemo: "held" })).toThrow(
    "动作不存在",
  );
});

test("full event also checks the idle reaction it restores; inspect and runtime do not speculate", () => {
  const base = document();
  const value = draft(base);
  value.config.events!.idle!.expressionId = "happy";
  value.config.events!.click = reaction();
  for (const mode of ["inspect", "runtime"] as const)
    expect(
      validatePreview(base, { ...value, mode, eventName: "click" }),
    ).toBeTruthy();
  expect(() =>
    validatePreview(base, { ...value, mode: "event", eventName: "click" }),
  ).toThrow("不支持该预览表情");
});

test("revision, selected scheme and foreign replacement validation still applies", () => {
  const base = document();
  const value = draft(base);
  expect(() => validatePreview(base, { ...value, baseRevision: 7 })).toThrow(
    "版本",
  );
  expect(() => validatePreview(base, { ...value, skinId: "foreign" })).toThrow(
    "配色不存在",
  );
  value.config.skins = [
    { id: "other", name: "other", replacements: { foreign: "foreign" } },
  ];
  expect(() => validatePreview(base, value)).toThrow("贴图不属于");
});

test("Live2D keeps full document ID validation, including unselected reactions", () => {
  const base = {
    ...document(),
    sourceType: "live2d" as const,
    character: characterFixture.document as unknown as CharacterDocument,
  };
  const value = { ...draft(base), skinId: null };
  value.config.events = {
    idle: reaction(),
    click: {
      ...reaction(base.character.expressions[0].id),
      motionId: base.character.motions[0].id,
    },
  };
  expect(validatePreview(base, value)).toBeTruthy();
  value.config.events.click!.expressionId = "foreign";
  expect(() => validatePreview(base, value)).toThrow("表情不存在");
});

const originalDesktop = window.futurePropsDesktop;
const report = vi.fn();
let receive: ((delivery: PetPreviewDelivery) => void) | undefined;
beforeEach(() => {
  api.get.mockReset();
  report.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      onPetPreview: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = undefined;
        };
      },
      currentPetPreview: async () => null,
      reportPetPreview: report,
    },
  });
});
afterEach(() => {
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: originalDesktop,
  });
});

test("actual delivery links idle with historic surprised/happy, rejects current effect, then recovers", async () => {
  const base = document();
  api.get.mockResolvedValue(base);
  const baseline = vi.fn();
  const { result, unmount } = renderHook(() => usePetPreview("pet", baseline));
  const value = draft(base);
  await act(async () => receive?.({ draft: value, paused: false }));
  expect(result.current.error).toBe("");
  expect(
    result.current.display?.document.config.events?.click?.expressionId,
  ).toBe("surprised");
  expect(
    result.current.display?.document.config.events?.pet?.expressionId,
  ).toBe("happy");
  expect(report).not.toHaveBeenCalled();
  const current = structuredClone(value);
  current.sequence++;
  current.config.events!.idle!.expressionId = "happy";
  await act(async () => receive?.({ draft: current, paused: false }));
  expect(result.current.display).toBeNull();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "lease",
      sequence: 2,
      state: "error",
      message: expect.stringContaining("不支持该预览表情"),
    }),
  );
  current.sequence++;
  current.config.events!.idle!.expressionId = null;
  await act(async () => receive?.({ draft: current, paused: false }));
  expect(result.current.error).toBe("");
  expect(result.current.display?.draft.sequence).toBe(3);
  expect(baseline.mock.lastCall?.[0]).toEqual(base);
  expect(base.config.events?.idle?.expressionId).toBeNull();
  unmount();
});
