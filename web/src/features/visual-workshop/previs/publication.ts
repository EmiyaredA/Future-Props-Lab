import type { SceneExport } from "../../../../vendor/toonflow/trumanHost";
import {
  getVisualCanvas,
  uploadMaterialNode,
  type VisualCanvasDocument,
} from "../api";
import {
  canvasBounds,
  placeNode,
  PLACEMENT_GAP,
} from "../canvas/canvasPlacement";
import type { PrevisScene } from "./api";

type Item = {
  requestId: string;
  file: File;
  shot?: number;
  kind: "frame" | "views" | "clip" | "previs";
  digest: string;
};

export type PrevisBatch = {
  scene: PrevisScene;
  remaining: Item[];
  published: number;
};

export async function makePrevisBatch(
  scene: PrevisScene,
  bundle: SceneExport,
): Promise<PrevisBatch> {
  const selected: Pick<Item, "file" | "shot" | "kind">[] = bundle.shots.flatMap(
    (entry, index) =>
      (["frame", "views", "clip"] as const).flatMap((kind) =>
        entry[kind]
          ? [{ file: entry[kind].file, shot: entry.number ?? index + 1, kind }]
          : [],
      ),
  );
  if (bundle.previs)
    selected.push({ file: bundle.previs.file, kind: "previs" });
  const remaining = await Promise.all(
    selected.map(async ({ file, ...source }) => {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      return {
        ...source,
        file,
        requestId: crypto.randomUUID(),
        digest: Array.from(new Uint8Array(bytes), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join(""),
      };
    }),
  );
  return { scene, remaining, published: 0 };
}

export async function publishPrevisBatch(
  project: string,
  batch: PrevisBatch,
  signal: AbortSignal,
  updateCanvas: (canvas: VisualCanvasDocument) => void,
  onItem?: () => void,
) {
  let canvas = await getVisualCanvas(project, signal);
  for (const item of [...batch.remaining]) {
    signal.throwIfAborted();
    const { x, y, width } = canvasBounds(canvas.nodes);
    const position = placeNode(
      canvas.nodes,
      item.kind === "clip" || item.kind === "previs" ? "video" : "image",
      {
        x: x + width + PLACEMENT_GAP,
        y,
      },
    );
    canvas = await uploadMaterialNode(
      project,
      item.file,
      canvas.revision,
      position,
      undefined,
      { signal },
      {
        request_id: item.requestId,
        scene_id: batch.scene.id,
        scene_revision: batch.scene.revision,
        shot_number: item.shot,
        artifact_kind: item.kind,
        sha256: item.digest,
      },
    );
    batch.remaining.shift();
    batch.published += 1;
    updateCanvas(canvas);
    onItem?.();
  }
  return batch.published;
}
