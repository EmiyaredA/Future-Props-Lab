import type {
  CanvasAlignmentGuide,
  CanvasSelectionBox,
} from "@features/visual-workshop/canvas/useCanvasPointerInteractions";

export function CanvasSelectionOverlay({
  selectionBox,
}: {
  selectionBox: CanvasSelectionBox | undefined;
}) {
  return selectionBox ? (
    <div className="canvas-selection-box" aria-hidden style={selectionBox} />
  ) : null;
}

export function CanvasAlignmentGuides({
  guides,
}: {
  guides: CanvasAlignmentGuide[];
}) {
  return guides.map((guide) => (
    <div
      className={`canvas-alignment-guide ${guide.axis}`}
      aria-hidden
      key={`${guide.axis}-${guide.position}`}
      style={
        guide.axis === "vertical"
          ? {
              left: guide.position,
              top: guide.start,
              height: guide.end - guide.start,
            }
          : {
              left: guide.start,
              top: guide.position,
              width: guide.end - guide.start,
            }
      }
    />
  ));
}
