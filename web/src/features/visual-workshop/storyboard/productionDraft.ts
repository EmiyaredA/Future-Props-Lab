import type { QueryClient } from "@tanstack/react-query";
import type { VisualCanvasGenerationDraft } from "../api";
import type { Card } from "../creative/api";
import { resolveDesignImage } from "../creative/cardMedia";
import type { Shot } from "./api";

/** Seed a new production node once; existing node settings remain user-owned. */
export async function productionDraft(
  client: QueryClient,
  project: string,
  kind: "image" | "video",
  shot: Shot,
  cards: Card[],
): Promise<VisualCanvasGenerationDraft> {
  const prompt = [
    shot.description,
    shot.shot_size && `景别：${shot.shot_size}`,
    shot.camera_motion && `运镜：${shot.camera_motion}`,
    shot.dialogue && `对白：${shot.dialogue}`,
    shot.sound && `声音：${shot.sound}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (prompt.length > (kind === "image" ? 6000 : 20000))
    throw new Error("镜头内容超过提示词长度限制，请精简后再创建制作节点。");
  const usable = cards.filter(
    (card) => shot.card_ids.includes(card.id) && card.adopted_asset_id,
  );
  if (usable.length > (kind === "image" ? 14 : 30))
    throw new Error(
      "关联的设定图超过生成参考数量限制，请减少后再创建制作节点。",
    );
  const references: {
    asset_id: string;
    card_id: string;
    card_revision: number;
    title: string;
  }[] = [];
  for (const card of usable)
    references.push({
      asset_id: await resolveDesignImage(client, project, card),
      card_id: card.id,
      card_revision: card.revision,
      title: card.title,
    });
  const ids = [...new Set(references.map(({ asset_id }) => asset_id))];
  return kind === "image"
    ? { prompt, image_count: 1, size: "1024x1024", reference_asset_ids: ids }
    : {
        prompt,
        duration: 5,
        mode: ids.length ? "reference" : "text",
        resolution: "720p",
        ratio: "16:9",
        generate_audio: false,
        watermark: true,
        reference_asset_ids: ids,
        design_references: references.filter(
          (entry, index) =>
            references.findIndex(
              (other) => other.asset_id === entry.asset_id,
            ) === index,
        ),
      };
}
