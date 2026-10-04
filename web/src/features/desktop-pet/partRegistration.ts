/** Static source-art rotation in model space, before any animated joint transform. */
export type RestTransform = { angle: number; pivot: [number, number] };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

/** Package boundary only: renderer-compiled typed meshes must never pass this reader. */
export function validatePartRegistrations(parts: unknown, rig: unknown): void {
  const fail = (): never => {
    throw new Error("静态素材登记仅支持版本二刚性骨段及有限旋转锚点");
  };
  if (!Array.isArray(parts)) fail();
  const versionTwo = record(rig) && rig.version === 2;
  const segments = new Set<string>();
  if (versionTwo) {
    const poses = record(rig.poses) ? Object.values(rig.poses) : [];
    if (Array.isArray(rig.transitions))
      for (const transition of rig.transitions)
        if (record(transition) && Array.isArray(transition.keyframes))
          for (const frame of transition.keyframes)
            if (record(frame) && record(frame.pose)) poses.push(frame.pose);
    for (const pose of poses)
      if (record(pose) && record(pose.limbs))
        for (const limb of Object.values(pose.limbs))
          if (record(limb) && Array.isArray(limb.segments))
            for (const id of limb.segments)
              if (typeof id === "string") segments.add(id);
  }
  for (const part of parts) {
    if (!record(part)) fail();
    if ("mesh" in part || "restAngle" in part)
      throw new Error("资源包不支持运行时网格或未登记的旋转字段");
    if (!("restTransform" in part)) continue;
    const transform = part.restTransform;
    if (
      !versionTwo ||
      typeof part.id !== "string" ||
      !segments.has(part.id) ||
      ("skin" in part && part.skin !== undefined) ||
      !record(transform) ||
      Object.keys(transform).length !== 2 ||
      !finite(transform.angle, 180) ||
      !Array.isArray(transform.pivot) ||
      transform.pivot.length !== 2 ||
      !transform.pivot.every((n) => finite(n, 512))
    )
      fail();
  }
}
