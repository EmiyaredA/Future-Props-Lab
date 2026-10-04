import type { PetEdge } from "@platform/petMotion";
import type {
  LoadedWhaleFigure,
  WhaleFigure,
  WhaleFrame,
} from "../whale-vendor/whale/figure.js";
import { SequencePlayer } from "./player";
import { validateSequenceImages } from "./validation";
import type { FrameSequences, SequenceSample } from "./types";

const NS = "http://www.w3.org/2000/svg";
const MAX_REQUEST_PIXELS = 16 * 1024 * 1024;
const MAX_CACHE_PIXELS = 32 * 1024 * 1024;
const edgeClip = (edge: PetEdge, facing: number) =>
  edge === "left" || edge === "right"
    ? `side-${edge}`
    : `${edge}-${facing < 0 ? "left" : "right"}`;

type SequenceSourceFigure = WhaleFigure & {
  draw: LoadedWhaleFigure["draw"];
  readonly scheme?: string;
  reset?(): void;
};

/** Whole painted cels use one canvas, one model scale, and no limb/face composition. */
export function createSequenceFigure(options: {
  base: SequenceSourceFigure;
  sequences: FrameSequences;
  scheme: string;
  defaultScheme: string;
  asset: (path: string) => string;
}): LoadedWhaleFigure {
  const { base, sequences, asset } = options;
  const player = new SequencePlayer(sequences);
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = sequences.frameSize;
  canvas.style.cssText = "width:100%;height:100%;display:block";
  const context = canvas.getContext("2d");
  if (!context) throw new Error("完整序列帧画布不可用");
  const object = document.createElementNS(NS, "foreignObject");
  object.append(canvas);
  const standing = document.createElementNS(NS, "g");
  let scheme = base.scheme || options.scheme;
  let disposed = false;
  let owner: SVGGElement | null = null;
  let displayed: SequenceSample | null = null;
  let failure: string | null = null;
  let progress: { id: string; progress: number } | null = null;
  let loading: Promise<void> | null = null;
  let revision = 0;
  let clock = 0;
  let lastTime: number | null = null;
  let requested: string | null = null;
  const images = new Map<string, HTMLImageElement>();
  const keyOf = (texture: string) => `${scheme}/${texture}`;
  const requestedClip = (frame: WhaleFrame) => {
    const motion = frame.locomotion;
    if (!motion) return frame.mode === "idle" ? "idle" : frame.mode;
    if (motion.state === "walk" || motion.state === "glide")
      return `${motion.state}-${motion.facing < 0 ? "left" : "right"}`;
    if (motion.state === "climb" && motion.edge)
      return edgeClip(motion.edge, motion.facing);
    return motion.state;
  };

  const supportsEdge = (edge: PetEdge) => {
    const ids =
      edge === "left" || edge === "right"
        ? [edgeClip(edge, 1)]
        : [edgeClip(edge, -1), edgeClip(edge, 1)];
    return ids.every((id) =>
      sequences.clips[id]?.frames.every((frame) => {
        const contact = frame.contacts?.[edge];
        const supports = Object.entries(frame.supports ?? {});
        if (!contact || !supports.length) return false;
        if (
          edge === "top" &&
          !supports.some(([name]) => name.startsWith("arm"))
        )
          return false;
        if (edge === "bottom" && supports.length < 2) return false;
        const normal = edge === "left" || edge === "right" ? 0 : 1;
        const scale = sequences.modelBox[2] / sequences.frameSize[0];
        return supports.every(
          ([, p]) => Math.abs(p[normal] - contact[normal]) * scale <= 1,
        );
      }),
    );
  };
  const supportedEdges = (
    ["left", "right", "top", "bottom"] as PetEdge[]
  ).filter(supportsEdge);

  function load(clip: string) {
    if (failure) return false;
    const ids = new Set([clip, displayed?.clip ?? "idle"]);
    for (const transition of sequences.transitions)
      if (
        transition.to === clip &&
        transition.from === (displayed?.clip ?? "idle")
      )
        ids.add(transition.clip);
    const clips = Object.fromEntries(
      [...ids].flatMap((id) =>
        sequences.clips[id] ? [[id, sequences.clips[id]]] : [],
      ),
    );
    const textures = [
      ...new Set(
        Object.values(clips).flatMap((item) =>
          item.frames.map((frame) => frame.texture),
        ),
      ),
    ];
    if (textures.every((texture) => images.has(keyOf(texture)))) return true;
    if (loading) return false;
    const generation = revision;
    const selectedScheme = scheme;
    loading = (async () => {
      let pixels = 0;
      const dimensions: Record<string, { width: number; height: number }> = {};
      const decoded = new Map<string, HTMLImageElement>();
      for (const texture of textures) {
        const key = `${selectedScheme}/${texture}`;
        let image = images.get(key);
        if (!image) {
          image = new Image();
          const prefix =
            selectedScheme === options.defaultScheme
              ? ""
              : `schemes/${selectedScheme}/`;
          image.src = asset(`${prefix}tex/${texture}.png`);
          await image.decode();
          if (disposed || generation !== revision) return;
        }
        pixels += image.naturalWidth * image.naturalHeight;
        if (pixels > MAX_REQUEST_PIXELS)
          throw new Error("完整动作图集超过解码预算");
        decoded.set(key, image);
        dimensions[texture] = {
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      }
      validateSequenceImages({ ...sequences, clips }, dimensions);
      if (disposed || generation !== revision) return;
      for (const [key, image] of decoded) images.set(key, image);
      let cached = [...images.values()].reduce(
        (sum, image) => sum + image.naturalWidth * image.naturalHeight,
        0,
      );
      for (const [key, image] of images) {
        if (cached <= MAX_CACHE_PIXELS) break;
        if (
          key.startsWith(`${selectedScheme}/`) &&
          textures.includes(key.slice(selectedScheme.length + 1))
        )
          continue;
        images.delete(key);
        cached -= image.naturalWidth * image.naturalHeight;
      }
    })()
      .catch((error: unknown) => {
        if (!disposed && generation === revision)
          failure =
            error instanceof Error ? error.message : "完整动作图集读取失败";
      })
      .finally(() => {
        loading = null;
      });
    return false;
  }

  return {
    fixedScale: true,
    get scheme() {
      return scheme;
    },
    motionFacing() {
      return 1;
    },
    groupTilt() {
      return 0;
    },
    pickupPoint() {
      return displayed
        ? [...displayed.anchors.grip]
        : (base.pickupPoint?.() ?? null);
    },
    getMotionFailure() {
      return failure ?? player.getMotionFailure();
    },
    getMotionTransition() {
      return !failure && !player.getMotionFailure() && progress
        ? { ...progress }
        : null;
    },
    cancelMotionPlayback() {
      player.cancelMotionPlayback();
      progress = null;
      failure = null;
      lastTime = null;
      revision += 1;
      requested = null;
    },
    reset() {
      player.cancelMotionPlayback();
      lastTime = null;
      revision += 1;
      requested = null;
      failure = null;
      progress = null;
      base.reset?.();
    },
    preload() {
      load("idle");
      return loading ?? Promise.resolve();
    },
    async setScheme(id, config) {
      if (id === scheme) return;
      const generation = ++revision;
      failure = null;
      lastTime = null;
      await base.setScheme(id, config);
      if (disposed || generation !== revision) return;
      scheme = base.scheme ?? id;
    },
    dispose() {
      disposed = true;
      revision += 1;
      images.clear();
      base.dispose?.();
    },
    draw(group, face, frame) {
      if (disposed) return;
      if (owner !== group) {
        group.replaceChildren(standing, object);
        owner = group;
      }
      const clip = requestedClip(frame);
      if (clip !== requested) {
        requested = clip;
        revision += 1;
        failure = null;
        progress = null;
      }
      const dt =
        lastTime === null ? 0 : Math.max(0, Math.min(0.1, frame.t - lastTime));
      lastTime = frame.t;
      if (!displayed) {
        object.style.display = "none";
        base.draw(standing, face, { ...frame, mode: "idle", locomotion: null });
        const original = standing.querySelector("canvas");
        original?.setAttribute("data-pet-raster-active", "true");
      }
      group.setAttribute("data-pet-supported-edges", supportedEdges.join(","));
      const stride =
        sequences.clips["walk-right"]?.distancePerCycle ??
        sequences.clips["walk-left"]?.distancePerCycle;
      if (stride) group.setAttribute("data-pet-stride", String(stride));
      if (!load(clip)) {
        progress = failure
          ? null
          : { id: `sequence-assets:${scheme}:${clip}`, progress: 0 };
        return;
      }
      // Paint the complete idle cel once; entry feedback must follow an actual draw.
      const initializing = !displayed && clip !== "idle";
      const sample = player.sample({
        clip: initializing ? "idle" : clip,
        t: clock + dt,
        phase: frame.locomotion?.phase ?? frame.gait?.phase,
        ...(frame.gripPoint ? { grip: frame.gripPoint } : {}),
      });
      if (!sample || sample.motionFailure) {
        progress = null;
        return;
      }
      const image = images.get(keyOf(sample.frame.texture));
      if (!image) {
        // Never report or commit progress for an unpainted cel.
        progress = { id: `sequence-assets:${scheme}:${clip}`, progress: 0 };
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        ...sample.frame.rect,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const [x, y, w, h] = sample.modelBox;
      object.setAttribute("x", String(x + sample.translation[0]));
      object.setAttribute("y", String(y + sample.translation[1]));
      object.setAttribute("width", String(w));
      object.setAttribute("height", String(h));
      standing.style.display = "none";
      object.style.display = "";
      standing
        .querySelector("canvas")
        ?.setAttribute("data-pet-raster-active", "false");
      canvas.setAttribute("data-pet-raster-active", "true");
      group.setAttribute("data-pet-sequence", "true");
      group.setAttribute(
        "data-pet-edges",
        JSON.stringify({
          ...sample.anchors.contacts,
          bottom: sample.anchors.contacts.bottom ?? sample.anchors.foot,
        }),
      );
      displayed = sample;
      clock += dt;
      progress = sample.transition
        ? { ...sample.transition }
        : player.getMotionTransition();
      if (initializing)
        progress = { id: `sequence-entry:${clip}`, progress: 0 };
    },
  };
}
