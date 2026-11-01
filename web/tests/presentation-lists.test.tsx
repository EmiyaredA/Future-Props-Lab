import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SlideTextEditor } from "@features/presentation-workshop/SlideTextEditor";
import { SelectionTextTools } from "@features/presentation-workshop/SelectionTextTools";
import { PresentationInspector } from "@features/presentation-workshop/PresentationInspector";
import { ElementContent } from "@features/presentation-workshop/SlideSurface";
import {
  newElement,
  newSlide,
  defaultRun,
} from "@features/presentation-workshop/templates";
import {
  fromEditor,
  toEditor,
} from "@features/presentation-workshop/textAdapter";
import {
  listAttributes,
  paragraphMarkers,
} from "@features/presentation-workshop/paragraphLists";
import type {
  Paragraph,
  SlideElement,
} from "@features/presentation-workshop/types";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const paragraphs: Paragraph[] = [
  "ordered",
  "ordered",
  "bullet",
  "ordered",
  "none",
].map((type, index) => ({
  align: "left",
  line_height: 1.3,
  ...listAttributes(type as "ordered" | "bullet" | "none"),
  runs: [{ ...defaultRun(`第 ${index + 1} 项\n续行`), bold: index === 0 }],
}));

it("roundtrips list styles and soft breaks, numbers contiguous items and restarts after other paragraphs", () => {
  const restored = fromEditor(toEditor(paragraphs), defaultRun());
  expect(
    restored.map((p) => ({ ...p, runs: p.runs.map((r) => r.text).join("") })),
  ).toEqual(
    paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => r.text).join("") })),
  );
  expect(paragraphMarkers(restored)).toEqual(["1.", "2.", "•", "1.", ""]);
  const { container } = render(
    <ElementContent element={newElement("text", { paragraphs })} />,
  );
  expect(
    Array.from(
      container.querySelectorAll(".presentation-bullet"),
      (node) => node.textContent,
    ),
  ).toEqual(["1.", "2.", "•", "1."]);
  expect(container.querySelector("p")?.style.paddingLeft).toBe("2em");
});

it("applies list style to the whole selected box and exposes mixed values", () => {
  const patch = vi.fn();
  render(
    <SelectionTextTools
      element={newElement("text", { paragraphs })}
      editor={null}
      patch={patch}
    />,
  );
  expect(screen.getByRole("combobox", { name: "列表类型" })).toHaveTextContent(
    "混合",
  );
  fireEvent.click(screen.getByRole("combobox", { name: "列表类型" }));
  fireEvent.click(screen.getByRole("option", { name: "编号列表" }));
  expect(patch).toHaveBeenCalledWith({
    paragraphs: paragraphs.map((p) => ({
      ...p,
      bullet: false,
      numbered: true,
    })),
  });
});

it.each([
  { readOnly: true, locked: false },
  { readOnly: false, locked: true },
])(
  "disables inspector list changes for $readOnly / $locked",
  ({ readOnly, locked }) => {
    const element = newElement("text", { locked, paragraphs });
    render(
      <PresentationInspector
        slide={{ ...newSlide("blank"), elements: [element] }}
        selected={[element.id]}
        patch={vi.fn()}
        background={vi.fn()}
        editor={null}
        arrange={vi.fn()}
        order={vi.fn()}
        editText={vi.fn()}
        readOnly={readOnly}
      />,
    );
    expect(screen.getByRole("combobox", { name: "列表类型" })).toBeDisabled();
  },
);

it("formats only selected paragraphs, preserves run styles and continues/exits a list on Enter", async () => {
  let editor: Editor | null = null;
  let latest: SlideElement;
  function Harness() {
    const [element, setElement] = useState(() =>
      newElement("text", {
        paragraphs: paragraphs.slice(0, 2).map((p, index) => ({
          ...p,
          runs: [{ ...defaultRun("内容"), bold: index === 0 }],
        })),
      }),
    );
    const [activeEditor, setEditor] = useState<Editor | null>(null);
    latest = element;
    return (
      <>
        <SlideTextEditor
          element={element}
          onChange={(next) =>
            setElement((old) => ({ ...old, paragraphs: next }))
          }
          onComposition={vi.fn()}
          onExit={vi.fn()}
          onReady={(ready) => {
            editor = ready;
            setEditor(ready);
          }}
        />
        <SelectionTextTools
          element={element}
          editor={activeEditor}
          patch={vi.fn()}
        />
      </>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  const active = editor!;
  act(() => {
    active.commands.setTextSelection({ from: 1, to: 3 });
  });
  fireEvent.click(screen.getByRole("combobox", { name: "列表类型" }));
  fireEvent.click(screen.getByRole("option", { name: "项目符号" }));
  expect(latest!.paragraphs.map((p) => [p.bullet, p.numbered])).toEqual([
    [true, false],
    [false, true],
  ]);
  expect(latest!.paragraphs[0].runs[0].bold).toBe(true);
  act(() => {
    active.commands.setTextSelection(active.state.doc.content.size - 1);
  });
  fireEvent.keyDown(active.view.dom, {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
  });
  expect(latest!.paragraphs).toHaveLength(3);
  expect(latest!.paragraphs[2].numbered).toBe(true);
  fireEvent.keyDown(active.view.dom, {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
  });
  expect(latest!.paragraphs).toHaveLength(3);
  expect(latest!.paragraphs[2].numbered).toBe(false);
  expect(latest!.paragraphs[2].bullet).toBe(false);
});
