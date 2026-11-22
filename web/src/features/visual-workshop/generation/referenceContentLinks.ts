import { api, unwrap } from "@platform/api/client";

async function cardLinks(ids: string[]) {
  const result = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const response = await unwrap(
      await api.POST("/v1/visual-workshop/asset-card-links", {
        body: { asset_ids: ids.slice(offset, offset + 500) },
      }),
    );
    response.items.forEach((item) =>
      item.card_ids.forEach((id) => result.add(id)),
    );
  }
  return [...result];
}

/** Exact IDs first; only verified whole-file equivalents can supply fallback links. */
export async function referenceContentCardIds(assetId: string) {
  const direct = await cardLinks([assetId]);
  if (direct.length) return direct;
  const response = await unwrap(
    await api.POST("/v1/files/content-identities", {
      body: { asset_ids: [assetId] },
    }),
  );
  const identities =
    response.items.find((item) => item.asset_id === assetId)?.equivalent_ids ??
    [];
  return identities.length ? cardLinks(identities) : [];
}
