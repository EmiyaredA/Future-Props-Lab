/** null is an authoritative miss; undefined alone retains unsupported legacy behavior. */
export type PetHitRegion = "head" | "body" | null;

/** A cranial hotspot bounded by the current painted crown-to-chin axis, excluding trailing hair. */
export function headHitRegion(
  point: { x: number; y: number },
  head: readonly [readonly [number, number], readonly [number, number]],
): "head" | "body" {
  const [crown, chin] = head;
  const dx = chin[0] - crown[0],
    dy = chin[1] - crown[1],
    lengthSquared = dx * dx + dy * dy,
    px = point.x - crown[0],
    py = point.y - crown[1];
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) return "body";
  const along = (px * dx + py * dy) / lengthSquared;
  const across = (px * dy - py * dx) / lengthSquared;
  // Longitudinal half-axis L/2, transverse half-axis 0.6L. The finite
  // crown/chin bounds prevent long hair tails or boots becoming head hits.
  return along >= 0 &&
    along <= 1 &&
    (2 * along - 1) ** 2 + (across / 0.6) ** 2 <= 1
    ? "head"
    : "body";
}

/** Only an unsupported renderer uses the former host-rectangle classification. */
export function reactionForHit(
  region: PetHitRegion | undefined,
  clientY: number,
  legacyBounds: { top: number; height: number } | null | undefined,
): "pet" | "click" | null {
  if (region === null) return null;
  if (region === "head") return "pet";
  if (region === "body") return "click";
  return legacyBounds && clientY < legacyBounds.top + legacyBounds.height * 0.48
    ? "pet"
    : "click";
}
