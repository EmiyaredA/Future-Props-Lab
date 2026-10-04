import type { AuthoredPose } from "./locomotion/authoredPose";
import type { MotionRig } from "./locomotion/articulation";

export type HumanFaceFrame = {
  t: number;
  mode: string;
  face: string;
  look: number[];
  blink: number;
  eyeClose: number;
  talk: number;
};
type FaceLayout = {
  view: number[];
  feat: { sprites: Record<string, number[]> };
  motionRig?: Pick<MotionRig, "profileHead">;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Owns feature placement and hair clipping; joint/body projection stays in the figure. */
export function paintHumanFace(
  context: CanvasRenderingContext2D,
  faceCanvas: HTMLCanvasElement,
  model: FaceLayout,
  images: Record<string, HTMLImageElement>,
  frame: HumanFaceFrame,
  blush: number,
  profile = 0,
  authoredFace?: AuthoredPose["face"],
) {
  const [x0, y0] = model.view;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  context.setTransform(3, 0, 0, 3, -x0 * 3, -y0 * 3);
  const sprite = (name: string, sy = 1, dx = 0, dy = 0) => {
    const bounds = model.feat.sprites[name];
    if (!bounds || !images[name]) return;
    const [x, y, right, bottom] = bounds;
    const w = right - x;
    const h = bottom - y;
    if (authoredFace) {
      const box = name.includes("eyes")
        ? authoredFace.eye
        : name === "brows"
          ? authoredFace.brow
          : authoredFace.mouth;
      const eye = name.includes("eyes") || name === "brows";
      const mapped =
        authoredFace.sprites?.[
          name as keyof NonNullable<AuthoredPose["face"]["sprites"]>
        ];
      const source = images[mapped ?? name];
      if (!source) return;
      const sourceRect =
        authoredFace.sourceRects?.[
          name as keyof NonNullable<AuthoredPose["face"]["sourceRects"]>
        ];
      const [sourceX, sourceY, sourceWidth, sourceHeight] = sourceRect ?? [
        0,
        0,
        eye && !authoredFace.twoEyes && !mapped
          ? source.width / 2
          : source.width,
        source.height,
      ];
      context.save();
      if (authoredFace.clip) {
        context.beginPath();
        authoredFace.clip.forEach(([px, py], i) =>
          i ? context.lineTo(px, py) : context.moveTo(px, py),
        );
        context.closePath();
        context.clip();
      }
      const centerX = authoredFace.eye[0] + authoredFace.eye[2] / 2,
        centerY = authoredFace.eye[1] + authoredFace.eye[3] / 2;
      context.translate(centerX, centerY);
      context.rotate((authoredFace.angle * Math.PI) / 180);
      context.translate(-centerX, -centerY);
      const closed = name === "closed_eyes";
      const drawWidth =
        eye && name !== "brows" && (mapped || sourceRect) && !closed
          ? (box[3] * sourceWidth) / sourceHeight
          : box[2];
      context.drawImage(
        source,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        box[0] + (box[2] - drawWidth) / 2 + dx,
        box[1] + dy + (closed ? box[3] * 0.7 : (box[3] * (1 - sy)) / 2),
        drawWidth,
        (closed ? 3 : box[3]) * sy,
      );
      context.restore();
      return;
    }
    context.globalAlpha = 1 - profile;
    context.drawImage(
      images[name],
      x + dx,
      y + dy + (h * (1 - sy)) / 2,
      w,
      h * sy,
    );
    if (profile && model.motionRig?.profileHead) {
      const feature = model.motionRig.profileHead;
      const [px, py, pw, ph] = name.includes("eyes")
        ? feature.eye
        : name === "brows"
          ? feature.brow
          : feature.mouth;
      const eye = name.includes("eyes") || name === "brows";
      const source = images[name];
      context.globalAlpha = profile;
      const closed = name === "closed_eyes";
      context.drawImage(
        source,
        0,
        0,
        eye ? source.width / 2 : source.width,
        source.height,
        px + dx,
        py + dy + (closed ? ph * 0.7 : (ph * (1 - sy)) / 2),
        pw,
        (closed ? 3 : ph) * sy,
      );
    }
    context.globalAlpha = 1;
  };
  const asleep =
    frame.mode === "sleep" || frame.face === "sleep" || frame.face === "sleepy";
  const closed = Math.max(
    frame.blink || 0,
    frame.eyeClose || 0,
    asleep ? 1 : 0,
  );
  const eyeName =
    frame.face === "angry"
      ? "angry_eyes"
      : frame.face === "surprised"
        ? "surprised_eyes"
        : "eyes";
  const openness = frame.face === "thinking" || frame.face === "shy" ? 0.8 : 1;
  if (closed > 0.8) sprite("closed_eyes");
  else
    sprite(
      eyeName,
      openness * (1 - closed),
      clamp(frame.look[0] * 0.22, -1.5, 1.5),
      clamp(frame.look[1] * 0.15, -1, 1),
    );
  sprite(
    "brows",
    1,
    0,
    frame.face === "surprised" ? -2 : frame.face === "angry" ? 1 : 0,
  );
  if (frame.face === "happy" || frame.face === "love" || frame.talk > 0.15)
    sprite(
      "happy_mouth",
      frame.talk > 0.15 ? 0.5 + Math.abs(Math.sin(frame.t * 12)) * 0.5 : 0.8,
    );
  else sprite("neutral_mouth");
  if (authoredFace) return;
  const alpha = Math.max(blush, frame.face === "shy" ? 0.8 : 0);
  if (alpha > 0.05) {
    const [left, top, right, bottom] = model.feat.sprites.eyes;
    for (const x of [left + 5, right - 5]) {
      const y = bottom + 4;
      const glow = context.createRadialGradient(x, y, 0, x, y, 8);
      glow.addColorStop(0, `rgba(245,115,130,${alpha * 0.4})`);
      glow.addColorStop(1, "rgba(245,115,130,0)");
      context.fillStyle = glow;
      context.fillRect(x - 8, top + 8, 16, 24);
    }
  }
}
