import type { VisualCanvasNode } from "../api";
import type { Shot } from "./api";

export function emptyShot(title = "新建分镜"): Shot {
  return {
    id: crypto.randomUUID(),
    title,
    description: "",
    shot_size: "",
    camera_motion: "",
    duration: null,
    dialogue: "",
    sound: "",
    source: null,
    previs: null,
    card_ids: [],
    origin_node_id: null,
    image_node_id: null,
    video_node_id: null,
  };
}

export function importShots(shots: Shot[], nodes: VisualCanvasNode[]): Shot[] {
  const seen = new Set(
    shots.map((shot) => shot.origin_node_id).filter(Boolean),
  );
  return [
    ...shots,
    ...nodes.flatMap((node) => {
      if ((node.kind !== "image" && node.kind !== "video") || seen.has(node.id))
        return [];
      seen.add(node.id);
      return [
        {
          ...emptyShot(node.title),
          origin_node_id: node.id,
          image_node_id: node.kind === "image" ? node.id : null,
          video_node_id: node.kind === "video" ? node.id : null,
        },
      ];
    }),
  ];
}

export function reorderShots(
  shots: Shot[],
  fromId: string,
  toId: string,
): Shot[] {
  const from = shots.findIndex(({ id }) => id === fromId);
  const to = shots.findIndex(({ id }) => id === toId);
  if (from < 0 || to < 0 || from === to) return shots;
  const result = [...shots];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}
