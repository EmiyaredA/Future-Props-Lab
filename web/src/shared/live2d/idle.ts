import type { CharacterDocument } from "./types";

export function idlePose(
  doc: CharacterDocument,
  base: Record<string, number>,
  elapsedMs: number,
  motionId?: string | null,
  expressionId?: string | null,
) {
  const values = { ...base };
  const rotations: Record<string, number> = {};
  const behavior = doc.idleBehavior;
  if (!behavior || behavior.intensity <= 0) return { values, rotations };
  const controlled = new Set<string>([
    ...(doc.motions.find((motion) => motion.id === motionId)?.tracks ?? []).map(
      (track) => track.parameterId,
    ),
    ...Object.keys(
      doc.expressions.find((expression) => expression.id === expressionId)
        ?.values ?? {},
    ),
  ]);
  const seconds = elapsedMs / 1000;
  const intensity = behavior.intensity;
  const apply = (id: string | null | undefined, amount: number) => {
    if (!id || controlled.has(id)) return;
    const parameter = doc.parameters.find((item) => item.id === id);
    if (!parameter) return;
    values[id] = Math.max(
      parameter.minimum,
      Math.min(parameter.maximum, parameter.default + amount * intensity),
    );
  };
  const cycle = Math.floor(elapsedMs / 3300);
  let closure = 0;
  for (let index = cycle - 1; index <= cycle + 1; index++) {
    const center = index * 3300 + 1700 + 430 * Math.sin(index * 1.618);
    const distance = Math.abs(elapsedMs - center);
    closure = Math.max(closure, Math.max(0, 1 - distance / 125));
  }
  apply(
    behavior.blinkParameter,
    1 -
      closure -
      (doc.parameters.find((item) => item.id === behavior.blinkParameter)
        ?.default ?? 1),
  );
  apply(
    behavior.gazeXParameter,
    0.46 * Math.sin(seconds * 0.73) + 0.14 * Math.sin(seconds * 1.37),
  );
  apply(behavior.gazeYParameter, 0.3 * Math.sin(seconds * 0.48 + 0.7));
  apply(behavior.breathParameter, Math.sin(seconds * 1.31) * 0.65);
  apply(
    behavior.swayParameter,
    0.55 * Math.sin(seconds * 0.91) + 0.15 * Math.sin(seconds * 1.57),
  );
  for (const [index, id] of (behavior.springBones ?? []).entries()) {
    const bone = doc.bones.find((item) => item.id === id);
    if (!bone) continue;
    rotations[id] =
      (1.4 * Math.sin(seconds * (1.08 + index * 0.18) + index * 1.3) +
        0.45 * Math.sin(seconds * (1.72 + index * 0.11))) *
      bone.spring *
      intensity;
  }
  return { values, rotations };
}
