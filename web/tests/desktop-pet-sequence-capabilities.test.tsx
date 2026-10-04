import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EditorStage } from "../src/features/desktop-pet/EditorStage";
import type { PetDocument } from "../src/features/desktop-pet/api";
import {
  clipForFrame,
  modelSequences,
  sequenceEdges,
  sequenceLinkUnavailable,
} from "../src/features/desktop-pet/sequences/capabilities";
import {
  humanMotionUnavailable,
  sequenceDemoUnavailable,
} from "../src/features/desktop-pet/locomotion/motionAvailability";
import { demoMotion } from "../src/features/desktop-pet/locomotion/demo";
import { SequencePlayer } from "../src/features/desktop-pet/sequences/player";
import type {
  FrameSequences,
  SequenceFrame,
} from "../src/features/desktop-pet/sequences/types";

vi.mock("../src/features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: () => <div data-testid="figure" />,
}));

function cel(n = 0): SequenceFrame {
  return {
    texture: "atlas",
    rect: [n * 16, 0, 16, 16],
    durationMs: 40,
    grip: [8, 8],
    foot: [8, 16],
    head: [
      [8, 0],
      [8, 6],
    ],
  };
}
function resource(): FrameSequences {
  return {
    version: 1,
    frameSize: [16, 16],
    modelBox: [-16, 0, 32, 32],
    headLength: 12,
    clips: { idle: { frames: [cel()], loop: true } },
    transitions: [],
  };
}
function connect(seq: FrameSequences, from: string, to: string) {
  const id = `${from}_to_${to}`;
  seq.clips[id] = {
    frames: [
      ...structuredClone(seq.clips[from].frames),
      structuredClone(seq.clips[to].frames[0]),
    ],
    loop: false,
  };
  seq.transitions.push({ id, from, to, clip: id });
}
function add(
  seq: FrameSequences,
  id: string,
  frame = cel(Object.keys(seq.clips).length),
) {
  seq.clips[id] = { frames: [frame], loop: true, distancePerCycle: 32 };
  connect(seq, "idle", id);
  connect(seq, id, "idle");
}
const model = (seq: FrameSequences) => ({
  rigProfile: "human-chibi",
  motionRig: { version: 1 },
  frameSequences: seq,
});

test.each([
  ["stand", undefined, "idle"],
  ["idle", -1, "idle"],
  ["walk", undefined, "walk-right"],
  ["run", -1, "walk-left"],
  ["walk", 1, "walk-right"],
  ["held", -1, "held"],
  ["jump", 1, "jump"],
])(
  "inspection mode %s follows the same directional clip convention",
  (mode, facing, expected) => {
    expect(clipForFrame({ mode, facing })).toBe(expected);
  },
);
test.each([
  ["walk-left", "walk-left"],
  ["walk-right", "walk-right"],
  ["climb-left", "side-left"],
  ["climb-right", "side-right"],
  ["climb-top", "top-right"],
  ["climb-bottom", "bottom-right"],
  ["glide-left", "glide-left"],
  ["held", "held"],
  ["land", "land"],
] as const)("physical demo %s owns its complete clip", (demo, expected) => {
  expect(clipForFrame({ mode: "stand", locomotion: demoMotion(demo, 0) })).toBe(
    expected,
  );
});

test("valid sequences override legacy v1, but partial resources only enable their own demos", () => {
  const seq = resource();
  add(seq, "held");
  expect(sequenceDemoUnavailable(model(seq), "held")).toBeNull();
  expect(humanMotionUnavailable(model(seq))).toContain("walk-left");
  expect(sequenceDemoUnavailable(model(seq), "walk-right")).toContain(
    "walk-right",
  );
  add(seq, "walk-left");
  add(seq, "walk-right");
  expect(humanMotionUnavailable(model(seq))).toBeNull();
  delete seq.clips["walk-right"].distancePerCycle;
  expect(humanMotionUnavailable(model(seq))).toContain("循环步距");
});

test.each([
  null,
  undefined,
  { version: 2 },
  { ...resource(), transitions: undefined },
])(
  "explicit malformed sequence %j fails instead of borrowing v2 limb motion",
  (frameSequences) => {
    const value = { motionRig: { version: 2 }, frameSequences };
    expect(modelSequences(value).kind).toBe("invalid");
    expect(humanMotionUnavailable(value)).toContain("无效");
    expect(sequenceDemoUnavailable(value, "held")).toContain("无效");
  },
);
test("absent resources preserve old whale sides and human v1 quarantine", () => {
  expect(
    humanMotionUnavailable({
      rigProfile: "human-chibi",
      motionRig: { version: 1 },
    }),
  ).toContain("暂停旧分件");
  expect(
    sequenceDemoUnavailable(
      { rigProfile: "human-chibi", motionRig: { version: 1 } },
      "held",
    ),
  ).toContain("暂停旧分件");
  expect(sequenceDemoUnavailable({}, "climb-left")).toBeNull();
  expect(sequenceDemoUnavailable({}, "climb-top")).toContain("未提供四边");
  expect(
    sequenceDemoUnavailable({ motionRig: { version: 2 } }, "climb-top"),
  ).toBeNull();
});

test("edge capabilities require every cel's support plane at the single model scale", () => {
  const seq = resource();
  const left = {
    ...cel(1),
    contacts: { left: [0, 8] as [number, number] },
    supports: { armNear: [0.5, 6] as [number, number] },
  };
  add(seq, "side-left", left);
  expect(sequenceEdges(seq)).toEqual(["left"]);
  expect(sequenceDemoUnavailable(model(seq), "climb-left")).toBeNull();
  seq.clips["side-left"].frames.push({
    ...structuredClone(left),
    supports: { armNear: [0.501, 6] },
  });
  expect(sequenceEdges(seq)).toEqual([]);
  expect(sequenceDemoUnavailable(model(seq), "climb-left")).toContain(
    "接触与支撑",
  );
});
test("top requires both directional cels and an arm; bottom needs two coplanar supports", () => {
  const seq = resource();
  const top: SequenceFrame = {
    ...cel(1),
    contacts: { top: [8, 0] },
    supports: { armNear: [6, 0] },
  };
  add(seq, "top-right", top);
  expect(sequenceEdges(seq)).not.toContain("top");
  add(seq, "top-left", top);
  expect(sequenceEdges(seq)).toContain("top");
  seq.clips["top-left"].frames[0].supports = { legBack: [6, 0] };
  expect(sequenceEdges(seq)).not.toContain("top");
  const bottom: SequenceFrame = {
    ...cel(2),
    contacts: { bottom: [8, 16] },
    supports: { armNear: [6, 16], legBack: [10, 16] },
  };
  add(seq, "bottom-left", bottom);
  add(seq, "bottom-right", bottom);
  expect(sequenceEdges(seq)).toContain("bottom");
  delete seq.clips["bottom-right"].frames[0].supports?.legBack;
  expect(sequenceEdges(seq)).not.toContain("bottom");
});

test("a graph path without a direct authored bridge cannot enable a demo", () => {
  const seq = resource();
  add(seq, "held");
  add(seq, "walk-right");
  seq.transitions = seq.transitions.filter(
    (item) => !(item.from === "idle" && item.to === "walk-right"),
  );
  connect(seq, "held", "walk-right");
  expect(sequenceDemoUnavailable(model(seq), "walk-right")).toContain(
    "idle → walk-right",
  );
});
test("static endpoint checks agree with actual player entry/exit and reject missing source cels", () => {
  const seq = resource();
  seq.clips.idle.frames.push(cel(1));
  add(seq, "held", cel(2));
  delete seq.clips.held.distancePerCycle;
  expect(sequenceDemoUnavailable(model(seq), "held")).toBeNull();
  const engine = new SequencePlayer(seq);
  engine.sample({ clip: "idle", t: 0 });
  engine.sample({ clip: "idle", t: 0.04 });
  expect(engine.sample({ clip: "held", t: 0.04 })?.transition).toBeDefined();
  expect(engine.sample({ clip: "held", t: 0.121 })?.clip).toBe("held");
  expect(engine.sample({ clip: "idle", t: 0.122 })?.transition).toBeDefined();
  seq.clips.idle_to_held.frames.splice(1, 1);
  expect(sequenceLinkUnavailable(seq, "idle", "held")).toContain(
    "当前动作端点",
  );
  const rejected = new SequencePlayer(seq);
  rejected.sample({ clip: "idle", t: 0 });
  rejected.sample({ clip: "idle", t: 0.04 });
  rejected.sample({ clip: "held", t: 0.04 });
  expect(rejected.getMotionFailure()).toBe(
    "sequence:transition-entry-mismatch",
  );
});
test("invalid bridge loop, distance and final painted identity are not accepted", () => {
  const seq = resource();
  add(seq, "held");
  seq.clips.idle_to_held.loop = true;
  expect(sequenceDemoUnavailable(model(seq), "held")).toContain("不能循环");
  seq.clips.idle_to_held.loop = false;
  seq.clips.idle_to_held.distancePerCycle = 1;
  expect(sequenceDemoUnavailable(model(seq), "held")).toContain("位移驱动");
  delete seq.clips.idle_to_held.distancePerCycle;
  seq.clips.idle_to_held.frames.at(-1)!.rect[0] = 32;
  expect(sequenceDemoUnavailable(model(seq), "held")).toContain("末帧");
});
test("glide demo requires authored landing and idle recovery instead of generic return", () => {
  const seq = resource();
  add(seq, "glide-right");
  expect(sequenceDemoUnavailable(model(seq), "glide-right")).toContain("land");
  add(seq, "land");
  expect(sequenceDemoUnavailable(model(seq), "glide-right")).toContain(
    "glide-right → land",
  );
  connect(seq, "glide-right", "land");
  expect(sequenceDemoUnavailable(model(seq), "glide-right")).toBeNull();
});

function stage(seq: FrameSequences) {
  const document: PetDocument = {
    revision: 0,
    sourceRevision: null,
    sourceType: "coopanion-whale",
    character: null,
    assetUrls: {},
    whaleAssets: {},
    whaleModel: model(seq),
    config: { schemaVersion: 2 },
  };
  const demonstrate = vi.fn();
  const preview = {
    eventName: "idle" as const,
    mode: "inspect" as const,
    key: 0,
    line: 0,
    bubble: "",
    demo: null,
    motionDemo: null,
    demonstrate,
    inspect: vi.fn(),
    play: vi.fn(),
    playSelected: vi.fn(),
    selectLine: vi.fn(),
  };
  const link = {
    enabled: false,
    available: false,
    message: "",
    toggle: vi.fn(),
  };
  const view = render(
    <EditorStage
      document={document}
      tab="preview"
      skinId={null}
      figureName="经典"
      preview={preview}
      link={link}
    />,
  );
  return { view, document, preview, link, demonstrate };
}
test("editor partial full frames allow keyboard held demo while disabling absent movement with reasons", async () => {
  const seq = resource();
  add(seq, "held");
  const { demonstrate } = stage(seq);
  const held = screen.getByRole("button", { name: "拎起" });
  expect(held).toBeEnabled();
  held.focus();
  await userEvent.keyboard(" ");
  expect(demonstrate).toHaveBeenCalledWith("held");
  const walk = screen.getByRole("button", { name: "向右行走（暂不支持）" });
  expect(walk).toBeDisabled();
  expect(walk).toHaveAttribute("title", expect.stringContaining("walk-right"));
  expect(screen.getByText("完整序列帧动画")).toBeVisible();
});

test("editor resource change disables the selected missing demo without remounting the figure", () => {
  const seq = resource();
  add(seq, "held");
  const { view, document, preview, link } = stage(seq);
  const figure = screen.getByTestId("figure");
  const next = { ...document, whaleModel: model(resource()) };
  view.rerender(
    <EditorStage
      document={next}
      tab="preview"
      skinId={null}
      figureName="经典"
      preview={{ ...preview, motionDemo: "held" }}
      link={link}
    />,
  );
  expect(
    screen.getByRole("button", { name: "拎起（暂不支持）" }),
  ).toBeDisabled();
  expect(screen.getByText("完整序列帧缺少动作：held")).toBeVisible();
  expect(screen.getByTestId("figure")).toBe(figure);
  fireEvent.click(screen.getByRole("button", { name: /播放事件/ }));
  expect(preview.playSelected).toHaveBeenCalledOnce();
});

test("missing return is independently blocked and malformed declarations never enable legacy demos", () => {
  const seq = resource();
  add(seq, "held");
  seq.transitions = seq.transitions.filter((item) => item.to !== "idle");
  expect(sequenceDemoUnavailable(model(seq), "held")).toContain("held → idle");
  const { view, document, preview, link } = stage(seq);
  view.rerender(
    <EditorStage
      document={{
        ...document,
        whaleModel: { motionRig: { version: 2 }, frameSequences: null },
      }}
      tab="preview"
      skinId={null}
      figureName="经典"
      preview={preview}
      link={link}
    />,
  );
  expect(
    screen.getByRole("button", { name: "拎起（暂不支持）" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "顶部悬挂爬行（暂不支持）" }),
  ).toBeDisabled();
  expect(screen.getByText("完整序列帧资源无效")).toBeVisible();
});
