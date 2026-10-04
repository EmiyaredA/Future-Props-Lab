import type {
  LoadedWhaleFigure,
  WhaleFigure,
} from "../whale-vendor/whale/figure.js";
import { SequencePlayer } from "./player";
import { validateSequenceImages } from "./validation";
import type {
  FrameSequences,
  SequenceSample,
  SequenceInput,
  SequenceFailure,
} from "./types";
import { clipForFrame, sequenceEdges } from "./capabilities";

const NS = "http://www.w3.org/2000/svg";
const MAX_REQUEST_PIXELS = 16 * 1024 * 1024;
const MAX_CACHE_PIXELS = 32 * 1024 * 1024;

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
  let wasPhysical = false;
  const images = new Map<string, HTMLImageElement>();
  const keyOf = (texture: string) => `${scheme}/${texture}`;
  const supportedEdges = sequenceEdges(sequences);

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
      wasPhysical = false;
    },
    reset() {
      player.cancelMotionPlayback();
      lastTime = null;
      revision += 1;
      requested = null;
      failure = null;
      progress = null;
      wasPhysical = false;
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
      const clip = clipForFrame(frame);
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
      const stride = sequences.clips[clip]?.distancePerCycle;
      if (stride) group.setAttribute("data-pet-stride", String(stride));
      else group.removeAttribute("data-pet-stride");
      const motion = frame.locomotion;
      const physical = motion?.state === "walk" || motion?.state === "climb";
      if (physical) wasPhysical = true;
      const supportRequired = wasPhysical;
      // Paint the complete idle cel once; entry feedback must follow an actual draw.
      const initializing = !displayed && clip !== "idle";
      // The outer SVG rounds its scale to four decimals. Use the matrix that
      // was actually installed, including the viewport, rather than nominal S.
      const matrix = group.getScreenCTM?.();
      const worldScale = matrix
        ? Math.hypot(matrix.a, matrix.b)
        : (frame.worldScale ?? 1);
      const direction =
        motion?.state === "walk" ||
        motion?.edge === "top" ||
        motion?.edge === "bottom"
          ? ([motion.facing, 0] as [number, number])
          : motion?.state === "climb" && motion.velocity.y !== 0
            ? ([0, Math.sign(motion.velocity.y)] as [number, number])
            : undefined;
      const input: SequenceInput = {
        clip: initializing ? "idle" : clip,
        t: clock + dt,
        phase: frame.locomotion?.phase ?? frame.gait?.phase,
        ...(frame.gripPoint ? { grip: frame.gripPoint } : {}),
        ...(supportRequired && motion?.travel
          ? {
              travel: [
                motion.travel.x / worldScale,
                motion.travel.y / worldScale,
              ] as [number, number],
              worldScale,
              ...(direction ? { direction } : {}),
            }
          : {}),
        ...(supportRequired ? { supportRequired: true } : {}),
        ...(supportRequired &&
        (motion?.state === "glide" || motion?.state === "held")
          ? { releaseSupportAtExit: true }
          : {}),
      };

      let invalid: SequenceFailure["reason"] | null = null;
      if (physical) {
        if (!motion.travel) invalid = "missing-confirmed-travel";
        else if (!sequences.clips[clip]) invalid = "missing-clip";
        else if (!stride) invalid = "missing-distance-per-cycle";
        else if (
          sequences.clips[clip].frames.some(
            (cel) => !Object.keys(cel.supports ?? {}).length,
          )
        )
          invalid = "missing-support";
      }
      let sample: SequenceSample | null;
      if (invalid)
        sample = player.rejectMotionPlayback({ ...input, clip }, invalid);
      else {
        if (!load(clip)) {
          progress = failure
            ? null
            : { id: `sequence-assets:${scheme}:${clip}`, progress: 0 };
          return;
        }
        sample = player.sample(input);
      }
      if (!sample) {
        progress = null;
        return;
      }
      if (
        sample.motionFailure &&
        displayed &&
        sample.translation.every(
          (value, axis) => value === displayed!.translation[axis],
        )
      ) {
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
      if (!sample.motionFailure) clock += dt;
      progress = sample.motionFailure
        ? null
        : sample.transition
          ? { ...sample.transition }
          : player.getMotionTransition();
      if (initializing)
        progress = { id: `sequence-entry:${clip}`, progress: 0 };
      if (
        supportRequired &&
        !physical &&
        !sample.motionFailure &&
        !sample.transition &&
        sample.clip === clip
      ) {
        player.endMotionSupport();
        wasPhysical = false;
      }
    },
  };
}
