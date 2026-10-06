/** null is an authoritative miss; undefined alone retains unsupported legacy behavior. */
export type PetHitRegion = "head" | "body" | null;

type ClientRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const validRect = (rect: ClientRect | null | undefined): rect is ClientRect =>
  Boolean(
    rect &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height),
  );

/** The displayed tray includes its inter-button gaps; only its actual client rect is padded. */
export function actionTrayHit(
  point: Readonly<{ x: number; y: number }>,
  tray: ClientRect | null | undefined,
  hovered: boolean,
): boolean {
  return (
    hovered &&
    validRect(tray) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= tray.x - 8 &&
    point.x <= tray.x + tray.width + 8 &&
    point.y >= tray.y - 8 &&
    point.y <= tray.y + tray.height + 8
  );
}

/** Connect a revalidated edge pixel to its tray, including at most 8 DIP of inner edge gap. */
export function actionTrayPath(
  point: Readonly<{ x: number; y: number }>,
  visible: ClientRect | null | undefined,
  tray: ClientRect | null | undefined,
  hovered: boolean,
  contact: Readonly<{ x: number; y: number }> | null | undefined,
): boolean {
  if (
    !hovered ||
    !contact ||
    !Number.isFinite(contact.x) ||
    !Number.isFinite(contact.y) ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !validRect(visible) ||
    !validRect(tray)
  )
    return false;
  const right = visible.x + visible.width,
    bottom = visible.y + visible.height;
  // The 80x100 alpha bounds are coarse; the revalidated contact is authoritative.
  if (contact.x < visible.x - 8 || contact.x > right + 8) return false;
  const left = Math.max(contact.x - 8, tray.x),
    overlapRight = Math.min(contact.x + 8, tray.x + tray.width);
  if (
    left >= overlapRight ||
    point.x < contact.x - 8 ||
    point.x > contact.x + 8
  )
    return false;
  const trayBottom = tray.y + tray.height;
  if (
    tray.y >= bottom &&
    Math.abs(bottom - contact.y) <= 8 &&
    tray.y - contact.y <= 96
  )
    return point.y >= contact.y && point.y <= trayBottom + 8;
  if (
    trayBottom <= visible.y &&
    Math.abs(contact.y - visible.y) <= 8 &&
    contact.y - trayBottom <= 96
  )
    return point.y >= tray.y - 8 && point.y <= contact.y;
  return false;
}

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
