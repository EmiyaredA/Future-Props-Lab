import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
import type { PetDocument } from "../src/features/desktop-pet/api";
import type { CharacterDocument } from "../src/shared/live2d/types";
import { evaluate, parameterValues } from "../src/shared/live2d/pose";
import { useEditorPreview } from "../src/features/desktop-pet/useEditorPreview";
import {
  live2dPlayback,
  reactionFor,
} from "../src/features/desktop-pet/playback";
import { validatePreview } from "../src/features/desktop-pet/usePetPreview";
import type { PetPreviewDraft } from "../src/platform/petPreview";

const tone = vi.hoisted(() => vi.fn());
vi.mock("../src/features/desktop-pet/sound", () => ({ playPetTone: tone }));
const character = fixture.document as unknown as CharacterDocument;
function document(): PetDocument {
  return {
    revision: 1,
    sourceRevision: 1,
    sourceType: "live2d",
    character,
    whaleModel: null,
    whaleAssets: null,
    assetUrls: { texture: "/v1/texture" },
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      schemeId: null,
      events: {
        click: {
          motionId: character.motions[0].id,
          expressionId: character.expressions[0].id,
          lines: ["第一句", "第二句"],
          sound: "tap",
        },
      },
      habits: {
        size: 220,
        roam: "off",
        draggable: true,
        edgeClimbing: true,
        highGliding: true,
        sound: true,
        bubbles: true,
        hoverActions: [],
      },
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  tone.mockClear();
});

test("draft edits preview immediately, hold expressions, rotate only manual lines and cancel old timers", () => {
  vi.useFakeTimers();
  const draft = document();
  const { result, rerender } = renderHook(
    ({
      value,
      event,
    }: {
      value: PetDocument;
      event: "click" | "idle" | "pet";
    }) => useEditorPreview(value, "events", event),
    { initialProps: { value: draft, event: "click" } },
  );
  expect(result.current.mode).toBe("inspect");
  expect(result.current.bubble).toBe("第一句");
  const initial = result.current.key;
  rerender({ value: { ...draft }, event: "click" });
  expect(result.current.key).toBe(initial);
  act(() => result.current.playSelected());
  expect(result.current.mode).toBe("event");
  expect(tone).toHaveBeenCalledTimes(1);
  act(() => result.current.playSelected());
  expect(result.current.bubble).toBe("第二句");
  const key = result.current.key;
  const cleared = {
    ...draft,
    config: {
      ...draft.config,
      events: {
        click: {
          ...draft.config.events!.click!,
          motionId: null,
          expressionId: null,
        },
      },
    },
  };
  rerender({ value: cleared, event: "click" });
  expect(result.current.mode).toBe("inspect");
  expect(result.current.key).toBeGreaterThan(key);
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.eventName).toBe("click");
  expect(result.current.mode).toBe("inspect");
  rerender({ value: draft, event: "pet" });
  expect(result.current.eventName).toBe("pet");
  act(() => result.current.inspect("pet"));
  expect(result.current.key).toBeGreaterThan(key);
  act(() => result.current.play("click"));
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.eventName).toBe("idle");
  expect(result.current.bubble).toBe("");
});

test("actual Live2D evaluator changes pose from the trigger start, holds inspected expression, and clears to idle", () => {
  const events = document().config.events!;
  const pose = (name: string, mode: "inspect" | "event", ms: number) => {
    const state = live2dPlayback(character, events, name, mode, ms);
    return evaluate(
      character,
      parameterValues(
        character,
        state.clipFrame,
        state.reaction?.motionId ?? undefined,
        state.reaction?.expressionId ?? undefined,
      ),
    );
  };
  expect(pose("click", "event", 500)).not.toEqual(pose("click", "event", 0));
  expect(pose("click", "inspect", 10000)).not.toEqual(
    pose("idle", "inspect", 0),
  );
  expect(pose("click", "event", 10000)).toEqual(pose("idle", "event", 0));
  const active = live2dPlayback(character, events, "click", "event", 0);
  expect(active.clipFrame).toBe(0);
  expect(
    live2dPlayback(
      character,
      {
        ...events,
        click: { ...events.click!, motionId: null, expressionId: null },
      },
      "click",
      "inspect",
      0,
    ).reaction?.motionId,
  ).toBeNull();
});

test("editing a later line displays that line without rotating or playing sound", () => {
  const draft = document();
  const { result, rerender } = renderHook(
    ({ value }) => useEditorPreview(value, "lines", "click"),
    { initialProps: { value: draft } },
  );
  act(() => result.current.selectLine(1));
  rerender({
    value: {
      ...draft,
      config: {
        ...draft.config,
        events: {
          click: {
            ...draft.config.events!.click!,
            lines: ["第一句", "正在修改第二句"],
          },
        },
      },
    },
  });
  expect(result.current.mode).toBe("inspect");
  expect(result.current.bubble).toBe("正在修改第二句");
  expect(tone).not.toHaveBeenCalled();
  act(() => result.current.playSelected());
  expect(result.current.bubble).toBe("第一句");
});

test("absent reactions retain whale defaults while explicit nulls clear them", () => {
  const whale = {
    ...document(),
    sourceType: "coopanion-whale" as const,
    config: { ...document().config, events: {} },
  };
  expect(reactionFor(whale, "click").motionId).toBe("hop");
  whale.config.events = {
    click: { motionId: null, expressionId: null, lines: [], sound: "none" },
  };
  expect(reactionFor(whale, "click").motionId).toBeNull();
});

test("draft validation rejects stale revision, foreign textures, unknown clips and unsupported expressions", () => {
  const base = document();
  const draft: PetPreviewDraft = {
    projectId: "pet",
    sessionId: "s",
    baseRevision: 1,
    sequence: 0,
    config: base.config,
    skinId: null,
    eventName: "click",
    mode: "inspect",
    key: 0,
    line: 0,
  };
  expect(validatePreview(base, draft).revision).toBe(1);
  expect(() => validatePreview(base, { ...draft, baseRevision: 0 })).toThrow(
    "项目版本",
  );
  expect(() =>
    validatePreview(base, {
      ...draft,
      config: {
        ...base.config,
        skins: [
          { id: "skin", name: "衣服", replacements: { texture: "foreign" } },
        ],
      },
    }),
  ).toThrow("贴图");
  expect(() =>
    validatePreview(base, {
      ...draft,
      config: {
        ...base.config,
        events: {
          click: {
            motionId: "foreign",
            expressionId: null,
            lines: [],
            sound: "none",
          },
        },
      },
    }),
  ).toThrow("动作不存在");
  const human = {
    ...base,
    sourceType: "coopanion-whale" as const,
    whaleModel: { rigProfile: "human-chibi", schemes: [] },
  };
  expect(() =>
    validatePreview(human, {
      ...draft,
      config: {
        ...base.config,
        events: {
          click: {
            motionId: null,
            expressionId: "wink",
            lines: [],
            sound: "none",
          },
        },
      },
    }),
  ).toThrow("不支持");
});
