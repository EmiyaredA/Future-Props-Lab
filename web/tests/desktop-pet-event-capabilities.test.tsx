import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import fixture from "../../tests/fixtures/live2d-evaluation.json";
import { DialogueInspector } from "../src/features/desktop-pet/DialogueInspector";
import type { PetDocument, PetReaction } from "../src/features/desktop-pet/api";
import type { CharacterDocument } from "../src/shared/live2d/types";
import {
  EXPRESSION_LABELS,
  MOTION_LABELS,
  reactionFor,
  reactionMotionUnavailable,
  reactionExpressionUnavailable,
  expressionSupported,
} from "../src/features/desktop-pet/playback";
import { clipForFrame } from "../src/features/desktop-pet/sequences/capabilities";
import type {
  FrameSequences,
  SequenceFrame,
} from "../src/features/desktop-pet/sequences/types";
import { createPet } from "../src/features/desktop-pet/whale-vendor/pet-core.js";
import type { HumanFrame } from "../src/features/desktop-pet/humanFigure";

const oldModel = { rigProfile: "human-chibi", motionRig: { version: 1 } };
function draft(model: Record<string, unknown> = oldModel): PetDocument {
  return {
    revision: 0,
    sourceRevision: null,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: model,
    whaleAssets: {},
    assetUrls: {},
    config: { schemaVersion: 2 },
  };
}
function cel(n = 0): SequenceFrame {
  return {
    texture: "atlas",
    rect: [16 * n, 0, 16, 16],
    durationMs: 40,
    grip: [8, 8],
    foot: [8, 16],
    head: [
      [8, 0],
      [8, 6],
    ],
  };
}
function sequence(): FrameSequences {
  return {
    version: 1,
    frameSize: [16, 16],
    modelBox: [0, 0, 32, 32],
    headLength: 12,
    clips: { idle: { frames: [cel()], loop: true } },
    transitions: [],
  };
}
function add(seq: FrameSequences, id: string) {
  seq.clips[id] = { frames: [cel(Object.keys(seq.clips).length)], loop: true };
  for (const [from, to] of [
    ["idle", id],
    [id, "idle"],
  ]) {
    const clip = `${from}_to_${to}`;
    seq.clips[clip] = {
      frames: [seq.clips[from].frames[0], seq.clips[to].frames[0]],
      loop: false,
    };
    seq.transitions.push({ id: clip, from, to, clip });
  }
}
const completeDraft = (seq: FrameSequences) =>
  draft({ ...oldModel, frameSequences: seq });

test.each(Object.keys(MOTION_LABELS))(
  "old v1 action %s reflects the renderer quarantine, preserving original standing/seated/sleep paths",
  (id) => {
    expect(reactionMotionUnavailable(draft(), id) === null).toBe(
      ["stand", "sit", "sleep"].includes(id),
    );
  },
);
test.each(Object.keys(EXPRESSION_LABELS))(
  "old v1 expression %s remains available only when the original face implementation supports it",
  (id) => {
    expect(expressionSupported(draft(), id)).toBe(
      !["wink", "sad"].includes(id),
    );
    expect(reactionExpressionUnavailable(draft(), id) === null).toBe(
      expressionSupported(draft(), id),
    );
  },
);
test("absent whale rig and authored v2 compatibility retain their existing reactions", () => {
  for (const model of [
    {},
    { rigProfile: "human-chibi", motionRig: { version: 2 } },
  ])
    for (const id of Object.keys(MOTION_LABELS))
      expect(reactionMotionUnavailable(draft(model), id)).toBeNull();
  expect(reactionExpressionUnavailable(draft({}), "wink")).toBeNull();
});
test("missing and unknown resource IDs remain unavailable while null means deliberate clear", () => {
  const live2d = {
    ...draft(),
    sourceType: "live2d" as const,
    character: fixture.document as unknown as CharacterDocument,
  };
  expect(
    reactionMotionUnavailable(live2d, live2d.character.motions[0].id),
  ).toBeNull();
  expect(
    reactionExpressionUnavailable(live2d, live2d.character.expressions[0].id),
  ).toBeNull();
  expect(reactionMotionUnavailable(live2d, "removed")).toContain("缺少");
  expect(reactionExpressionUnavailable(live2d, "removed")).toContain("缺少");
  for (const id of ["__proto__", "constructor", "removed"])
    expect(reactionMotionUnavailable(draft(), id)).toContain("尚未接入");
  expect(reactionExpressionUnavailable(draft(), "__proto__")).toContain(
    "尚未接入",
  );
  expect(reactionMotionUnavailable(draft(), null)).toBeNull();
  expect(reactionExpressionUnavailable(draft(), null)).toBeNull();
});
test("full-frame actual modes require complete resource entry and return; old v1 never overrides them", () => {
  const seq = sequence();
  const document = completeDraft(seq);
  expect(reactionMotionUnavailable(document, "stand")).toBeNull();
  expect(reactionMotionUnavailable(document, "look")).toContain("look");
  add(seq, "look");
  expect(reactionMotionUnavailable(document, "look")).toBeNull();
  seq.transitions = seq.transitions.filter((item) => item.from !== "look");
  expect(reactionMotionUnavailable(document, "look")).toContain("look → idle");
  add(seq, "sit");
  add(seq, "sleep");
  add(seq, "dizzy");
  for (const id of ["sit", "sleep", "dizzy"])
    expect(reactionMotionUnavailable(document, id)).toBeNull();
  add(seq, "walk-right");
  expect(reactionMotionUnavailable(document, "walk")).toContain("步距");
  seq.clips["walk-right"].distancePerCycle = 32;
  expect(reactionMotionUnavailable(document, "walk")).toBeNull();
  expect(reactionMotionUnavailable(document, "run")).toBeNull();
});
test.each(["jump", "hop", "nod", "shake", "turn", "spin"])(
  "merely adding a %s atlas does not implement its legacy physics or pulse action",
  (id) => {
    const seq = sequence();
    add(seq, id);
    expect(reactionMotionUnavailable(completeDraft(seq), id)).toContain(
      "尚未接入此动作阶段",
    );
  },
);
test("full painted faces have no expression variants, and invalid sequences cannot activate old faces", () => {
  const document = completeDraft(sequence());
  expect(reactionExpressionUnavailable(document, "neutral")).toBeNull();
  for (const id of Object.keys(EXPRESSION_LABELS).filter(
    (id) => id !== "neutral",
  ))
    expect(reactionExpressionUnavailable(document, id)).toContain(
      "未提供表情变体",
    );
  const invalid = draft({ ...oldModel, frameSequences: null });
  expect(reactionMotionUnavailable(invalid, "stand")).toContain("无效");
  expect(reactionExpressionUnavailable(invalid, "neutral")).toContain("无效");
  expect(reactionExpressionUnavailable(invalid, null)).toBeNull();
});

function engine() {
  const svg = (name: string) =>
    document.createElementNS("http://www.w3.org/2000/svg", name);
  const frames: HumanFrame[] = [];
  const pet = createPet(
    {
      petG: svg("g") as SVGGElement,
      shadowEl: svg("ellipse"),
      fxG: svg("g") as SVGGElement,
    },
    {
      roam: "off",
      walkInPlace: true,
      startX: 82,
      sfx: new Proxy({}, { get: () => () => {} }),
      bounds: () => ({ W: 165, H: 220, floorY: 212, S: 0.793269 }),
      figure: {
        fixedScale: true,
        draw: (_group: unknown, _face: unknown, frame: HumanFrame) =>
          frames.push(structuredClone(frame)),
      },
    },
  );
  return {
    pet,
    frames,
    tick: () => {
      pet.step(0.01);
      pet.render();
    },
  };
}
test("real pet action engine requests crouch/air for jump but only idle for pulse actions, not similarly named cel clips", () => {
  const { pet, frames, tick } = engine();
  for (const id of ["nod", "shake", "spin", "turn"]) {
    pet.replaceReaction(id, null, true);
    tick();
    expect(clipForFrame(frames.at(-1)!)).toBe("idle");
  }
  pet.replaceReaction("jump", null, true);
  tick();
  expect(clipForFrame(frames.at(-1)!)).toBe("crouch");
  for (let i = 0; i < 30; i++) tick();
  expect(frames.some((frame) => clipForFrame(frame) === "air")).toBe(true);
  expect(frames.some((frame) => clipForFrame(frame) === "jump")).toBe(false);
  pet.replaceReaction("look", null, true);
  tick();
  expect(clipForFrame(frames.at(-1)!)).toBe("look");
});

function Inspector({
  document,
  saved,
  changed,
}: {
  document: PetDocument;
  saved: PetReaction;
  changed: (patch: Partial<PetReaction>) => void;
}) {
  const [reaction, setReaction] = useState(saved);
  return (
    <DialogueInspector
      tab="events"
      eventLabel="点击身体"
      reaction={reaction}
      whale={document.sourceType === "coopanion-whale"}
      draft={document}
      config={document.config}
      readOnly={false}
      editReaction={(patch) => {
        changed(patch);
        setReaction((current) => ({ ...current, ...patch }));
      }}
      selectLine={() => {}}
      edit={() => {}}
    />
  );
}
const saved: PetReaction = {
  motionId: "look",
  expressionId: "wink",
  sound: "none",
  lines: [],
};
test("disabled saved Chinese values stay visible, expose the reason, and clear by keyboard without auto rewriting", async () => {
  const changed = vi.fn();
  render(<Inspector document={draft()} saved={saved} changed={changed} />);
  const trigger = screen.getByRole("button", { name: "动作" });
  expect(trigger).toHaveTextContent("张望");
  expect(screen.getByRole("button", { name: "表情" })).toHaveTextContent(
    "眨单眼",
  );
  expect(changed).not.toHaveBeenCalled();
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  const look = screen.getByRole("menuitemradio", {
    name: "张望（暂不支持）",
  });
  expect(look).toHaveAttribute("data-disabled");
  expect(look).toHaveAttribute(
    "title",
    expect.stringContaining("已暂停旧分件动作"),
  );
  expect(look).toHaveAttribute(
    "aria-description",
    expect.stringContaining("仅保留站立"),
  );
  expect(trigger).toHaveTextContent("张望（暂不支持）");
  expect(trigger).toHaveAttribute(
    "aria-description",
    look.getAttribute("title"),
  );
  expect(look).toBeChecked();
  await userEvent.keyboard("{Home}{Enter}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(changed).toHaveBeenLastCalledWith({ motionId: null });
  expect(trigger).toHaveTextContent("无动作");
  await userEvent.click(screen.getByRole("button", { name: "表情" }));
  expect(
    screen.getByRole("menuitemradio", { name: "眨单眼（暂不支持）" }),
  ).toHaveAttribute("data-disabled");
  await userEvent.click(screen.getByRole("menuitemradio", { name: "无表情" }));
  expect(changed).toHaveBeenLastCalledWith({ expressionId: null });
});
test("original seated actions and supported expressions stay selectable, while full frames disclose missing variants", async () => {
  const changed = vi.fn();
  const view = render(
    <Inspector document={draft()} saved={saved} changed={changed} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "动作" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "坐下" }));
  expect(changed).toHaveBeenLastCalledWith({ motionId: "sit" });
  await userEvent.click(screen.getByRole("button", { name: "表情" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "开心" }));
  expect(changed).toHaveBeenLastCalledWith({ expressionId: "happy" });
  view.unmount();
  changed.mockClear();
  render(
    <Inspector
      document={completeDraft(sequence())}
      saved={{ ...saved, expressionId: "happy" }}
      changed={changed}
    />,
  );
  expect(screen.getByRole("button", { name: "表情" })).toHaveTextContent(
    "开心（暂不支持）",
  );
  expect(screen.getByText("完整序列帧未提供表情变体，暂不支持")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "表情" }));
  expect(
    screen.getByRole("menuitemradio", { name: "开心（暂不支持）" }),
  ).toHaveAttribute("data-disabled");
  await userEvent.click(screen.getByRole("menuitemradio", { name: "自然" }));
  expect(changed).toHaveBeenLastCalledWith({ expressionId: "neutral" });
});
test("removed saved Live2D values are visible and clearable, and default fallback does not mutate saved config", async () => {
  const document = {
    ...draft(),
    sourceType: "live2d" as const,
    character: fixture.document as unknown as CharacterDocument,
  };
  const changed = vi.fn();
  render(
    <Inspector
      document={document}
      saved={{
        ...saved,
        motionId: "removed",
        expressionId: "removed-expression",
      }}
      changed={changed}
    />,
  );
  expect(screen.getByRole("button", { name: "动作" })).toHaveTextContent(
    "removed（暂不支持）",
  );
  expect(changed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "动作" }));
  expect(
    screen.getByRole("menuitemradio", { name: /removed（/ }),
  ).toHaveAttribute("data-disabled");
  await userEvent.click(screen.getByRole("menuitemradio", { name: "无动作" }));
  expect(changed).toHaveBeenLastCalledWith({ motionId: null });
  const old = draft();
  const snapshot = structuredClone(old.config);
  expect(reactionFor(old, "grab").motionId).toBe("look");
  expect(
    reactionMotionUnavailable(old, reactionFor(old, "grab").motionId),
  ).not.toBeNull();
  expect(old.config).toEqual(snapshot);
});
