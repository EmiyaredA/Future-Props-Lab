import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PresentationShape } from "@features/presentation-workshop/PresentationShape";
import { PresentationShapeSettings } from "@features/presentation-workshop/PresentationShapeSettings";
import { newElement } from "@features/presentation-workshop/templates";
import {
  fontFamily,
  fromEditor,
  toEditor,
} from "@features/presentation-workshop/textAdapter";

it("uses distinct arrow markers for repeated slide surfaces and both endpoints", () => {
  const element = newElement("line", {
    start_arrow: "triangle",
    end_arrow: "triangle",
    stroke_dash: "dash",
    stroke_width: 2,
  });
  const { container } = render(
    <>
      <PresentationShape element={element} />
      <PresentationShape element={element} />
    </>,
  );
  const markers = [...container.querySelectorAll('marker[id$="-triangle"]')];
  expect(new Set(markers.map((m) => m.id)).size).toBe(2);
  const lines = [...container.querySelectorAll("line")];
  lines.forEach((line, i) => {
    expect(line.getAttribute("marker-start")).toBe(`url(#${markers[i].id})`);
    expect(line.getAttribute("marker-end")).toBe(`url(#${markers[i].id})`);
  });
  expect(container.querySelector("g")).toHaveAttribute(
    "stroke-dasharray",
    "8 6",
  );
});

it("preserves transparent fill, zero radius, and old auto-radius appearance", () => {
  const element = newElement("roundRect", {
    fill_opacity: 0,
    corner_radius: 0,
  });
  const { container, rerender } = render(
    <PresentationShape element={element} />,
  );
  expect(container.querySelector("g")).toHaveAttribute("fill-opacity", "0");
  expect(container.querySelector("rect")).toHaveAttribute("rx", "0");
  rerender(<PresentationShape element={{ ...element, corner_radius: null }} />);
  expect(
    Number(container.querySelector("rect")?.getAttribute("rx")),
  ).toBeCloseTo(180 * 0.166);
});

it("edits opacity and radius independently and disables read-only controls", () => {
  const patch = vi.fn();
  const element = newElement("roundRect", { corner_radius: 4 });
  const { rerender } = render(
    <PresentationShapeSettings
      element={element}
      patch={patch}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("填充不透明度（%）"), {
    target: { value: "0" },
  });
  expect(patch).toHaveBeenLastCalledWith({ fill_opacity: 0 });
  fireEvent.change(screen.getByLabelText("圆角半径"), {
    target: { value: "12" },
  });
  expect(patch).toHaveBeenLastCalledWith({ corner_radius: 12 });
  rerender(
    <PresentationShapeSettings element={element} patch={patch} disabled />,
  );
  expect(screen.getByLabelText("圆角半径")).toBeDisabled();
});

it("round trips regex punctuation and Consolas through text editing", () => {
  const element = newElement("text");
  const run = {
    ...element.paragraphs[0].runs[0],
    font: "Consolas" as const,
    text: String.raw`(?<!\d)(?P<number>\d+\.\d+|\d+)`,
  };
  const paragraphs = [{ ...element.paragraphs[0], runs: [run] }];
  expect(fromEditor(toEditor(paragraphs), run)).toEqual(paragraphs);
  expect(fontFamily("Consolas")).toContain("monospace");
});
