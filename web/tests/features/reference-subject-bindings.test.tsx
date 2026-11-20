import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReferenceSubjectEditor } from "@features/visual-workshop/generation/ReferenceSubjectEditor";
import {
  compileReferenceSubjects,
  resolveReferenceSubjects,
} from "@features/visual-workshop/generation/referenceSubjects";
import { cloneCanvasSelection } from "@features/visual-workshop/canvas/canvasClipboard";
import { removeDisconnectedEdgeReferences } from "@features/visual-workshop/canvas/canvasGraph";
import type {
  VisualCanvasNode,
  VisualCanvasEdge,
} from "@features/visual-workshop/api";

const keyFor = (id: string) =>
  id === "hand" ? "edge:hand-input" : `asset:${id}`;

test("Chinese choices save English targets and unresolved legacy targets cannot be overwritten", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <ReferenceSubjectEditor title="角色参考" value="person" onChange={save} />,
  );
  const trigger = screen.getByRole("button", { name: "追踪对象 角色参考" });
  expect(trigger).toHaveTextContent("人");
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: /手.*hand/ }));
  expect(save).toHaveBeenLastCalledWith("hand");
  await user.click(trigger);
  await user.type(
    screen.getByRole("textbox", { name: "自定义追踪对象" }),
    "abc",
  );
  await user.keyboard("{Escape}");
  expect(save).toHaveBeenCalledTimes(1);
  view.rerender(
    <ReferenceSubjectEditor
      title="角色参考"
      value=""
      disabled
      onChange={save}
    />,
  );
  expect(trigger).toBeDisabled();
  expect(trigger).toHaveTextContent("待关联");
});
test("legacy targets bind in displayed image order only after all outputs resolve", () => {
  expect(
    resolveReferenceSubjects(
      null,
      "person, hand",
      ["person", "hand"],
      keyFor,
      false,
    ),
  ).toBeNull();
  expect(
    resolveReferenceSubjects(null, "person, hand", ["person"], keyFor, true),
  ).toBeNull();
  expect(
    resolveReferenceSubjects(
      null,
      "person, hand",
      ["person", "hand"],
      keyFor,
      true,
    ),
  ).toEqual({ "asset:person": "person", "edge:hand-input": "hand" });
  expect(
    resolveReferenceSubjects(
      {},
      "person, hand",
      ["person", "hand"],
      keyFor,
      true,
    ),
  ).toEqual({});
  expect(
    compileReferenceSubjects(
      { "asset:person": "person", "edge:hand-input": "hand" },
      ["hand", "person"],
      keyFor,
    ),
  ).toBe("hand, person");
});
test("cloning remaps edge identities while disconnected subjects are removed", () => {
  const nodes: VisualCanvasNode[] = [
    {
      id: "source",
      kind: "image",
      title: "手",
      asset_id: "image",
      position: { x: 0, y: 0 },
    },
    {
      id: "target",
      kind: "video",
      title: "镜头",
      position: { x: 200, y: 0 },
      generation_draft: {
        mode: "reference",
        prompt: "",
        duration: 5,
        resolution: "720p",
        ratio: "16:9",
        watermark: false,
        generate_audio: false,
        reference_subjects: { "edge:hand-input": "hand" },
      },
    },
  ];
  const edges: VisualCanvasEdge[] = [
    {
      id: "hand-input",
      source_node_id: "source",
      target_node_id: "target",
      binding: "final",
    },
  ];
  const result = cloneCanvasSelection(
    { nodes, edges, origin: { x: 0, y: 0 } },
    { x: 20, y: 20 },
  );
  const target = result.nodes.find((node) => node.kind === "video")!;
  if (target.kind !== "video") throw new Error("missing video");
  expect(target.generation_draft?.reference_subjects).toEqual({
    [`edge:${result.edges[0].id}`]: "hand",
  });
  const cleaned = removeDisconnectedEdgeReferences(nodes, edges, [
    "hand-input",
  ]);
  const cleared = cleaned[1];
  if (cleared.kind !== "video") throw new Error("missing video");
  expect(cleared.generation_draft?.reference_subjects).toEqual({});
});
