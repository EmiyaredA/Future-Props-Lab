import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PetRuntime } from "@features/desktop-pet/PetRuntime";
import { validatePreview } from "@features/desktop-pet/usePetPreview";
import type { PetDocument } from "@features/desktop-pet/api";
import type { PetPreviewDelivery, PetPreviewDraft } from "@platform/petPreview";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  chat: vi.fn(),
  model: vi.fn(),
}));
vi.mock("@features/desktop-pet/api", () => ({
  getDocument: state.get,
  updateDocument: state.update,
  getChat: state.chat,
  sendChat: state.model,
}));
vi.mock("@shared/ui/theme", () => ({ useTheme: () => undefined }));
vi.mock("@features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: forwardRef(function Figure(
    props: {
      document: PetDocument;
      skinId?: string | null;
      motionDemo?: string | null;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ hitTest: () => true }));
    return (
      <div
        data-testid="runtime-figure"
        data-revision={props.document.revision}
        data-size={props.document.config.habits?.size}
        data-skin={props.skinId ?? ""}
        data-demo={props.motionDemo ?? ""}
      />
    );
  }),
}));
const saved = (): PetDocument => ({
  revision: 1,
  sourceType: "coopanion-whale",
  sourceRevision: 1,
  character: null,
  whaleModel: {
    rigProfile: "human-chibi",
    motionRig: { version: 1 },
    schemes: [{ id: "classic" }, { id: "maid" }],
  },
  whaleAssets: {},
  assetUrls: {},
  config: {
    schemaVersion: 2,
    skins: [],
    activeSkinId: null,
    schemeId: "classic",
    events: {},
    persona: {
      personality: "",
      description: "",
      speakingStyle: "",
      greeting: "",
    },
    habits: {
      roam: "off",
      size: 220,
      draggable: true,
      edgeClimbing: true,
      highGliding: true,
      bubbles: false,
      sound: false,
      hoverActions: ["dress", "roam"],
    },
  },
});
const draft = (base: PetDocument): PetPreviewDraft => ({
  projectId: "pet",
  sessionId: "editor-session",
  baseRevision: base.revision,
  sequence: 1,
  config: {
    ...base.config,
    schemeId: "maid",
    habits: { ...base.config.habits!, size: 300, roam: "free" },
  },
  skinId: "maid",
  eventName: "idle",
  mode: "inspect",
  key: 1,
  line: 0,
  motionDemo: null,
});
const originalBridge = window.futurePropsDesktop;
let baseline: PetDocument;
let receive: ((delivery: PetPreviewDelivery) => void) | null;
let current: PetPreviewDelivery;
const report = vi.fn(),
  close = vi.fn(),
  open = vi.fn(),
  studio = vi.fn();
beforeEach(() => {
  baseline = saved();
  receive = null;
  current = null;
  state.get
    .mockReset()
    .mockImplementation(async () => structuredClone(baseline));
  state.update.mockReset();
  state.model.mockReset();
  state.chat.mockReset().mockResolvedValue({ proactiveLinesEnabled: false });
  report.mockReset().mockResolvedValue(undefined);
  close.mockReset().mockImplementation(async () => {
    current = null;
  });
  open.mockReset().mockResolvedValue(undefined);
  studio.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      closePet: close,
      openPet: open,
      showStudioFromPet: studio,
      setPetInteractive: vi.fn(),
      onPetPreview: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = null;
        };
      },
      currentPetPreview: async () => current,
      reportPetPreview: report,
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: originalBridge,
  });
});
const mount = async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<PetRuntime projectId="pet" />);
  });
  fireEvent.pointerMove(view.container.firstElementChild!);
  return view;
};
const assertNoWritesOrModel = () => {
  expect(state.update).not.toHaveBeenCalled();
  expect(state.model).not.toHaveBeenCalled();
};

test("close/open component lifecycle discards temporary runtime outfit/roam while keeping saved baseline", async () => {
  const first = await mount();
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-skin",
    "classic",
  );
  fireEvent.click(screen.getByRole("button", { name: "换装" }));
  fireEvent.click(screen.getByRole("button", { name: "走动：不乱动" }));
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-skin",
    "maid",
  );
  expect(screen.getByRole("button", { name: "走动：多待着" })).toBeVisible();
  await window.futurePropsDesktop?.closePet?.();
  first.unmount();
  await window.futurePropsDesktop?.openPet?.("pet");
  const reopened = await mount();
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-skin",
    "classic",
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-size",
    "220",
  );
  expect(screen.getByRole("button", { name: "走动：不乱动" })).toBeVisible();
  expect(close).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith("pet");
  assertNoWritesOrModel();
  reopened.unmount();
});

test("close/open drops an editor draft and uses the newest saved revision without writing the draft", async () => {
  const first = await mount();
  const editorDirty = draft(baseline);
  const untouched = structuredClone(editorDirty);
  current = { draft: editorDirty, paused: false };
  await act(async () => receive?.(current));
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-size",
    "300",
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-skin",
    "maid",
  );
  expect(screen.getByText("临时预览，尚未保存")).toBeVisible();
  await window.futurePropsDesktop?.closePet?.();
  first.unmount();
  baseline = {
    ...saved(),
    revision: 2,
    config: {
      ...saved().config,
      habits: { ...saved().config.habits!, size: 240 },
    },
  };
  await window.futurePropsDesktop?.openPet?.("pet");
  const reopened = await mount();
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-revision",
    "2",
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-size",
    "240",
  );
  expect(screen.queryByText("临时预览，尚未保存")).not.toBeInTheDocument();
  expect(editorDirty).toEqual(untouched);
  assertNoWritesOrModel();
  reopened.unmount();
});

test("a pending old draft fetch cannot revive a closed runtime or alter the reopened saved baseline", async () => {
  const first = await mount();
  const send = receive!;
  const old = draft(baseline);
  let resolve!: (value: PetDocument) => void;
  state.get.mockImplementationOnce(
    () =>
      new Promise<PetDocument>((done) => {
        resolve = done;
      }),
  );
  act(() => send({ draft: old, paused: false }));
  await window.futurePropsDesktop?.closePet?.();
  first.unmount();
  baseline = { ...saved(), revision: 3 };
  const reopened = await mount();
  await act(async () => resolve(saved()));
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-revision",
    "3",
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-size",
    "220",
  );
  expect(screen.queryByText("临时预览，尚未保存")).not.toBeInTheDocument();
  assertNoWritesOrModel();
  reopened.unmount();
});

test("preview validation rejects a demo missing actual human resource capability", () => {
  expect(() =>
    validatePreview(baseline, { ...draft(baseline), motionDemo: "held" }),
  ).toThrow(/完整|旧分件|姿态/);
});

test("unsupported linked demo reports an error and leaves the saved runtime display", async () => {
  const view = await mount();
  await act(async () =>
    receive?.({
      draft: { ...draft(baseline), motionDemo: "held" },
      paused: false,
    }),
  );
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "editor-session",
      sequence: 1,
      state: "error",
    }),
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute(
    "data-size",
    "220",
  );
  expect(screen.getByTestId("runtime-figure")).toHaveAttribute("data-demo", "");
  assertNoWritesOrModel();
  view.unmount();
});

test("link and capability status share one compact region and keyboard exposes full reasons", async () => {
  const user = userEvent.setup();
  const view = await mount();
  await act(async () => receive?.({ draft: draft(baseline), paused: false }));
  const status = screen.getByRole("status");
  expect(view.container.querySelectorAll(".pet-runtime-status")).toHaveLength(
    1,
  );
  expect(status).toHaveAccessibleName(/临时预览.*完整动作姿势/);
  const summary = screen.getByRole("button", { name: "临时预览，尚未保存" });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("button", { name: "打开应用" }),
  ).not.toBeInTheDocument();
  summary.focus();
  await user.keyboard("{Enter}");
  expect(summary).toHaveAttribute("aria-expanded", "true");
  const details = document.getElementById(
    summary.getAttribute("aria-controls")!,
  );
  expect(details).toHaveTextContent("当前人物资源缺少完整动作姿势");
  // Enter opens without moving focus into the panel; Escape must work here too.
  expect(summary).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(summary).toHaveFocus();
  await user.keyboard("{Enter}");
  const openApp = screen.getByRole("button", { name: "打开应用" });
  openApp.focus();
  await user.keyboard("{Enter}");
  expect(studio).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(summary).toHaveFocus();
  assertNoWritesOrModel();
  view.unmount();
});

test("expanded status text is interactive UI and cannot initiate a character drag", async () => {
  const view = await mount();
  const summary = screen.getByRole("button", { name: "部分动作不可用" });
  fireEvent.click(summary);
  const details = document.getElementById(
    summary.getAttribute("aria-controls")!,
  );
  const host = view.container.firstElementChild as HTMLElement;
  host.setPointerCapture = vi.fn();
  expect(details).not.toBeNull();
  fireEvent.pointerMove(details!);
  fireEvent.pointerDown(details!.querySelector("p")!);
  expect(host.setPointerCapture).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "部分动作不可用" }),
  ).toHaveAttribute("aria-expanded", "true");
  assertNoWritesOrModel();
  view.unmount();
});

test("partial new complete-frame resource reports missing action without the old-animation summary", async () => {
  const cel = {
    texture: "whole",
    rect: [0, 0, 100, 200],
    durationMs: 100,
    grip: [50, 70],
    foot: [50, 190],
    head: [
      [50, 10],
      [50, 50],
    ],
  };
  baseline.whaleModel = {
    schemes: [{ id: "classic" }, { id: "maid" }],
    frameSequences: {
      version: 1,
      frameSize: [100, 200],
      modelBox: [0, 0, 50, 100],
      headLength: 20,
      clips: { idle: { frames: [cel], loop: true } },
      transitions: [],
    },
  };
  const view = await mount();
  const summary = screen.getByRole("button", { name: "部分动作不可用" });
  expect(screen.getByRole("status")).toHaveAccessibleName(
    /缺少动作.*walk-left/,
  );
  expect(screen.queryByText("旧分件动画已暂停")).not.toBeInTheDocument();
  fireEvent.click(summary);
  expect(
    document.getElementById(summary.getAttribute("aria-controls")!),
  ).toHaveTextContent("walk-left");
  expect(() =>
    validatePreview(baseline, { ...draft(baseline), motionDemo: "held" }),
  ).toThrow(/缺少动作.*held/);
  assertNoWritesOrModel();
  view.unmount();
});
