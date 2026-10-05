import type { PetEdge, PetGeometry } from "@platform/petMotion";

/** Own one lazy alpha-readback surface per renderer, never per frame or globally. */
export function createFigureGeometrySampler() {
  let sample: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  const getContext = () => {
    if (!sample) {
      sample = document.createElement("canvas");
      sample.width = 80;
      sample.height = 100;
    }
    context ??= sample.getContext("2d", { willReadFrequently: true });
    return context;
  };
  return {
    measure(group: SVGGElement) {
      return figureGeometry(group, getContext);
    },
    dispose() {
      if (sample) {
        sample.width = 0;
        sample.height = 0;
      }
      context = null;
      sample = null;
    },
  };
}

/** Sample the current painted alpha, not a full-resolution GPU readback. */
function figureGeometry(
  group: SVGGElement,
  getContext: () => CanvasRenderingContext2D | null,
): PetGeometry | null {
  const canvas =
    group.querySelector<HTMLCanvasElement>(
      'canvas[data-pet-raster-active="true"]',
    ) ?? group.querySelector("canvas");
  const object = canvas?.closest("foreignObject");
  const matrix = object?.getScreenCTM();
  if (!canvas || !object || !matrix) return null;
  const context = getContext();
  if (!context) return null;
  context.clearRect(0, 0, 80, 100);
  context.drawImage(canvas, 0, 0, 80, 100);
  const pixels = context.getImageData(0, 0, 80, 100).data;
  let left = 80,
    right = -1,
    top = 100,
    bottom = -1;
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 80; x++) {
      if (pixels[(y * 80 + x) * 4 + 3] <= 24) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (right < left) return null;
  const x0 = object.x.baseVal.value,
    y0 = object.y.baseVal.value;
  const w = object.width.baseVal.value,
    h = object.height.baseVal.value;
  const point = (x: number, y: number) =>
    new DOMPoint(x0 + (x * w) / 80, y0 + (y * h) / 100).matrixTransform(matrix);
  const corners = [
    point(left, top),
    point(right + 1, top),
    point(left, bottom + 1),
    point(right + 1, bottom + 1),
  ];
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  const visible = {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
  const anchorMatrix = group.getScreenCTM();
  if (!anchorMatrix) return null;
  // The rest sole stays stable while individual feet lift; alpha bounds still protect every limb.
  const authored = group.getAttribute("data-pet-edges");
  const planes = authored
    ? (JSON.parse(authored) as Record<PetEdge, [number, number]>)
    : null;
  const feet = new DOMPoint(...(planes?.bottom ?? [128, 256])).matrixTransform(
    anchorMatrix,
  );
  const authoredEdge = (edge: PetEdge): PetEdge =>
    anchorMatrix.a < 0 && (edge === "left" || edge === "right")
      ? edge === "left"
        ? "right"
        : "left"
      : edge;
  const edges = planes
    ? (Object.fromEntries(
        (["left", "right", "top", "bottom"] as PetEdge[]).map((edge) => {
          // Iterate screen sides: partial authored planes must never overwrite fallbacks.
          const p = planes[authoredEdge(edge)];
          if (!p)
            return [
              edge,
              {
                x:
                  edge === "left"
                    ? visible.x
                    : edge === "right"
                      ? visible.x + visible.width
                      : feet.x,
                y:
                  edge === "top"
                    ? visible.y
                    : edge === "bottom"
                      ? feet.y
                      : visible.y + visible.height / 2,
              },
            ];
          const mapped = new DOMPoint(...p).matrixTransform(anchorMatrix);
          return [edge, { x: mapped.x, y: mapped.y }];
        }),
      ) as PetGeometry["edges"])
    : undefined;
  const authoredSupportedEdges = group
    .getAttribute("data-pet-supported-edges")
    ?.split(",")
    .filter(Boolean) as PetEdge[] | undefined;
  const supportedEdges = authoredSupportedEdges?.map(authoredEdge);
  const authoredStride = Number(group.getAttribute("data-pet-stride"));
  const strideLength =
    authoredStride > 0
      ? authoredStride * Math.hypot(anchorMatrix.a, anchorMatrix.b)
      : undefined;
  return {
    visible,
    feet: { x: feet.x, y: feet.y },
    edges,
    supportedEdges,
    strideLength,
  };
}
