import type { PageSize, SlideElement } from "../../types";
import type { FormulaDrawing } from "./useFormulaPreview";

export function formulaGeometry(
  element: SlideElement,
  drawing: FormulaDrawing,
  page: PageSize,
  original?: { element: SlideElement; drawing?: FormulaDrawing },
) {
  // The image renderer uses contain: recover the user's uniform scale from its box.
  const scale = original
    ? Math.min(
        original.element.width / (original.drawing?.width ?? drawing.width),
        original.element.height / (original.drawing?.height ?? drawing.height),
      ) *
      (original.drawing
        ? 1
        : element.formula!.size / original.element.formula!.size)
    : 1;
  const x = original
    ? element.x
    : Math.max(0, Math.min(element.x, page.width - 1));
  const y = original
    ? element.y
    : Math.max(0, Math.min(element.y, page.height - 1));
  const width = drawing.width * scale,
    height = drawing.height * scale;
  const fit = Math.min(
    1,
    Math.max(1, page.width - Math.max(0, x)) / width,
    Math.max(1, page.height - Math.max(0, y)) / height,
    10000 / width,
    10000 / height,
  );
  return {
    x,
    y,
    width: Math.max(1, width * fit),
    height: Math.max(1, height * fit),
  };
}
