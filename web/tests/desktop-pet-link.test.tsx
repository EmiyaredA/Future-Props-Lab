import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PetDocument } from "../src/features/desktop-pet/api";
import type {
  PetPreviewDelivery,
  PetPreviewDraft,
  PetPreviewStatus,
} from "../src/platform/petPreview";
import { usePetPreview } from "../src/features/desktop-pet/usePetPreview";
import { useDesktopPreviewLink } from "../src/features/desktop-pet/useDesktopPreviewLink";

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/features/desktop-pet/api", () => ({ getDocument: state.get }));
const base: PetDocument = {
  revision: 1,
  sourceType: "coopanion-whale",
  sourceRevision: 1,
  character: null,
  whaleModel: { schemes: [{ id: "normal" }] },
  whaleAssets: {},
  assetUrls: {},
  config: {
    schemaVersion: 2,
    events: {},
    skins: [],
    activeSkinId: null,
    schemeId: "normal",
    persona: {
      personality: "不应传输",
      description: "",
      speakingStyle: "",
      greeting: "",
    },
    habits: {
      size: 220,
      roam: "calm",
      draggable: true,
      edgeClimbing: true,
      highGliding: true,
      bubbles: true,
      sound: true,
      hoverActions: [],
    },
  },
};
const draft = (): PetPreviewDraft => ({
  projectId: "pet",
  sessionId: "s",
  baseRevision: 1,
  sequence: 0,
  config: { ...base.config, habits: { ...base.config.habits!, size: 280 } },
  skinId: "normal",
  eventName: "click",
  mode: "inspect",
  key: 1,
  line: 0,
});
const original = window.futurePropsDesktop;
let receive: ((value: PetPreviewDelivery) => void) | undefined;
let status: ((value: PetPreviewStatus) => void) | undefined;
const update = vi.fn(),
  end = vi.fn(),
  report = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  state.get.mockReset().mockResolvedValue(structuredClone(base));
  update.mockReset().mockResolvedValue({ state: "active" });
  end.mockReset().mockResolvedValue(undefined);
  report.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      petStatus: async () => ({ projectId: "pet", visible: true }),
      beginPetPreview: async ({ sessionId }: { sessionId: string }) => ({
        sessionId,
        state: "active",
        message: "临时预览，尚未保存",
      }),
      updatePetPreview: update,
      endPetPreview: end,
      onPetPreviewStatus: (callback: typeof status) => {
        status = callback;
        return () => {
          status = undefined;
        };
      },
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
  vi.useRealTimers();
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: original,
  });
});

test("link defaults off, excludes persona, syncs newest draft, and releases on unmount", async () => {
  const preview = {
    eventName: "click" as const,
    mode: "inspect" as const,
    key: 2,
    line: 0,
    bubble: "",
    motionDemo: null,
    demo: null,
    demonstrate: vi.fn(),
    inspect: vi.fn(),
    play: vi.fn(),
    playSelected: vi.fn(),
    selectLine: vi.fn(),
  };
  const { result, rerender, unmount } = renderHook(
    ({ value }) => useDesktopPreviewLink("pet", value, "normal", preview),
    { initialProps: { value: base } },
  );
  await act(async () => {});
  expect(result.current.available).toBe(true);
  expect(update).not.toHaveBeenCalled();
  await act(() => result.current.toggle());
  expect(result.current.enabled).toBe(true);
  expect(update.mock.lastCall?.[0].config).not.toHaveProperty("persona");
  const sequence = update.mock.lastCall?.[0].sequence;
  rerender({
    value: {
      ...base,
      revision: 2,
      config: { ...base.config, habits: { ...base.config.habits!, size: 280 } },
    },
  });
  await act(async () => {});
  expect(update.mock.lastCall?.[0].baseRevision).toBe(2);
  expect(update.mock.lastCall?.[0].sequence).toBeGreaterThan(sequence);
  const sessionId = update.mock.lastCall?.[0].sessionId;
  act(() =>
    status?.({ sessionId, state: "paused", message: "聊天中，联动已暂停" }),
  );
  expect(result.current.message).toContain("暂停");
  unmount();
  expect(end).toHaveBeenCalledWith(sessionId);
});

test("pet loads authorized baseline, pauses display for chat and restores saved baseline on release", async () => {
  const baseline = vi.fn();
  const { result } = renderHook(() => usePetPreview("pet", baseline));
  await act(async () => receive?.({ draft: draft(), paused: false }));
  expect(result.current.display?.document.config.habits?.size).toBe(280);
  expect(baseline.mock.lastCall?.[0].config.habits.size).toBe(220);
  await act(async () => receive?.({ draft: draft(), paused: true }));
  expect(result.current.linked).toBe(true);
  expect(result.current.display).toBeNull();
  await act(async () => receive?.({ draft: draft(), paused: false }));
  expect(result.current.display?.document.config.habits?.size).toBe(280);
  state.get.mockResolvedValue({
    ...base,
    revision: 2,
    config: { ...base.config, habits: { ...base.config.habits!, size: 240 } },
  });
  await act(async () => receive?.(null));
  expect(result.current.linked).toBe(false);
  expect(result.current.display).toBeNull();
  expect(baseline.mock.lastCall?.[0].revision).toBe(2);
});

test("outdated revisions are reported and a released lease cannot be revived by a pending asset fetch", async () => {
  const baseline = vi.fn();
  const { result } = renderHook(() => usePetPreview("pet", baseline));
  await act(async () =>
    receive?.({ draft: { ...draft(), baseRevision: 0 }, paused: false }),
  );
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({
      state: "error",
      message: expect.stringContaining("版本"),
    }),
  );
  let resolve!: (value: PetDocument) => void;
  state.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => receive?.({ draft: draft(), paused: false }));
  await act(async () => receive?.(null));
  await act(async () => resolve(base));
  expect(result.current.display).toBeNull();
  expect(result.current.linked).toBe(false);
});
