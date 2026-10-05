import type { PetMotionBudget } from "@platform/petMotion";

/** Remaining displacement is relative to the renderer's receipt, not each tick. */
export function remainingMotionBudget(
  budget: PetMotionBudget,
  confirmed: { x: number; y: number },
): number {
  if (
    !budget.epoch ||
    ![
      budget.remainingDIP,
      budget.confirmedTravel.x,
      budget.confirmedTravel.y,
      confirmed.x,
      confirmed.y,
    ].every(Number.isFinite) ||
    budget.remainingDIP < 0
  )
    return 0;
  return Math.max(
    0,
    budget.remainingDIP -
      Math.hypot(
        confirmed.x - budget.confirmedTravel.x,
        confirmed.y - budget.confirmedTravel.y,
      ),
  );
}

/** Includes the entire outstanding target; an in-flight RPC cannot multiply the allowance. */
export function boundedMotionTarget(
  origin: { x: number; y: number },
  target: { x: number; y: number },
  remaining: number,
): { x: number; y: number } {
  const dx = target.x - origin.x,
    dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= remaining || distance === 0) return { ...target };
  const ratio = Math.max(0, remaining) / distance;
  return { x: origin.x + dx * ratio, y: origin.y + dy * ratio };
}
