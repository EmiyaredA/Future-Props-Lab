import {
  isTransitionContainer,
  transitionSegmentForFrame,
} from "./transitions";
import type {
  LoadedWhaleFigure,
  WhaleFigure,
} from "../whale-vendor/whale/figure.js";
import { SequencePlayer, type SequencePresentationRequest } from "./player";
import { validateSequenceImages } from "./validation";
import { headHitRegion } from "../interaction";
import type {
  FrameSequences,
  SequenceSample,
  SequenceInput,
  SequenceFailure,
  SequenceRect,
  SequenceProgress,
} from "./types";
import { clipForFrame, sequenceEdges } from "./capabilities";

const NS = "http://www.w3.org/2000/svg";
const MAX_REQUEST_PIXELS = 16 * 1024 * 1024;
const MAX_CACHE_PIXELS = 32 * 1024 * 1024;
const REQUEST_BUDGET_ERROR = "完整动作图集超过解码预算";

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
  let assetError: string | null = null;
  let hitError: string | null = null;
  let hitSurface: HTMLCanvasElement | null = null;
  let hitContext: CanvasRenderingContext2D | null = null;
  let hitFailedImage: HTMLImageElement | null = null;
  let progress: SequenceProgress | null = null;
  let loading: Promise<void> | null = null;
  let revision = 0;
  let clock = 0;
  let lastTime: number | null = null;
  let requested: string | null = null;
  let wasPhysical = false;
  let rejectedReaction: string | null = null;
  let painted: {
    image: HTMLImageElement;
    rect: SequenceRect;
    width: number;
    height: number;
    scheme: string;
  } | null = null;
  const images = new Map<string, HTMLImageElement>();
  const keyOf = (texture: string) => `${scheme}/${texture}`;
  const supportedEdges = sequenceEdges(sequences);

  function retryAssetLoad() {
    hitError = null;
    hitFailedImage = null;
    if (hitSurface) hitSurface.width = 1;
    if (disposed || !failure) return;
    failure = null;
    progress = null;
    lastTime = null;
    requested = null;
    revision += 1;
  }

  function load(clip: string) {
    if (disposed || failure) return false;
    // Pin only the actually drawn cel, the requested action and the selected tail.
    // A shared container can contain many unrelated tails and is not a decode unit.
    const clips: FrameSequences["clips"] = {};
    if (sequences.clips[clip]) clips.target = sequences.clips[clip];
    if (displayed) clips.actual = { loop: false, frames: [displayed.frame] };
    else if (sequences.clips.idle) clips.actual = sequences.clips.idle;
    if (
      displayed?.transition &&
      displayed.requestedClip === clip &&
      displayed.clipRange
    ) {
      clips.bridge = {
        loop: false,
        frames: sequences.clips[displayed.clip].frames.slice(
          ...displayed.clipRange,
        ),
      };
    } else {
      const transition = sequences.transitions.find(
        (item) => item.to === clip && item.from === (displayed?.clip ?? "idle"),
      );
      const segment =
        transition &&
        transitionSegmentForFrame(
          sequences,
          transition,
          displayed?.frameIndex ?? 0,
        );
      if (segment)
        clips.bridge = {
          loop: false,
          frames: sequences.clips[segment.clip].frames.slice(
            segment.start,
            segment.end,
          ),
        };
    }
    const textures = [
      ...new Set(
        Object.values(clips).flatMap((item) =>
          item.frames.map((frame) => frame.texture),
        ),
      ),
    ];
    const cachedPixels = textures.reduce((sum, texture) => {
      const image = images.get(keyOf(texture));
      return sum + (image ? image.naturalWidth * image.naturalHeight : 0);
    }, 0);
    // Cached and freshly decoded atlases share the same request working-set limit.
    if (cachedPixels > MAX_REQUEST_PIXELS) {
      failure = assetError = REQUEST_BUDGET_ERROR;
      return false;
    }
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
        if (pixels > MAX_REQUEST_PIXELS) throw new Error(REQUEST_BUDGET_ERROR);
        decoded.set(key, image);
        dimensions[texture] = {
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      }
      validateSequenceImages({ clips }, dimensions);
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
        if (painted?.image === image) painted = null;
        if (hitFailedImage === image) hitFailedImage = null;
        cached -= image.naturalWidth * image.naturalHeight;
      }
    })()
      .catch((error: unknown) => {
        if (!disposed && generation === revision) {
          failure =
            error instanceof Error ? error.message : "完整动作图集读取失败";
          assetError = failure;
        }
      })
      .finally(() => {
        loading = null;
      });
    return false;
  }

  function hitTest(point: { x: number; y: number }): boolean | null {
    if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      return false;
    if (!displayed) return base.hitTest?.(point) ?? null;
    // Requested/decoded cels do not own hits until their actual paint commits.
    if (!painted || painted.image === hitFailedImage) return false;
    const [x, y, width, height] = displayed.modelBox;
    const u = (point.x - x - displayed.translation[0]) / width;
    const v = (point.y - y - displayed.translation[1]) / height;
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return false;
    const [sx, sy, sw, sh] = painted.rect;
    try {
      if (!hitSurface) {
        hitSurface = document.createElement("canvas");
        hitSurface.width = hitSurface.height = 1;
      }
      hitContext ??= hitSurface.getContext("2d", {
        willReadFrequently: true,
      });
      if (!hitContext) throw new Error("完整序列帧点击区域不可用");
      hitContext.clearRect(0, 0, 1, 1);
      hitContext.drawImage(
        painted.image,
        sx + Math.floor(u * sw),
        sy + Math.floor(v * sh),
        1,
        1,
        0,
        0,
        1,
        1,
      );
      const hit = hitContext.getImageData(0, 0, 1, 1).data[3] > 24;
      hitError = null;
      hitFailedImage = null;
      return hit;
    } catch {
      hitFailedImage = painted.image;
      hitError = "完整序列帧点击区域读取失败";
      // A tainted sampler must not poison the next successfully painted image.
      if (hitSurface) hitSurface.width = 1;
      return false;
    }
  }

  return {
    fixedScale: true,
    hitTest,
    classifyHit(point) {
      if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        return null;
      if (!displayed) {
        // A blank/loading renderer is not unsupported legacy artwork.
        if (!owner || !standing.hasChildNodes()) return null;
        return base.classifyHit?.(point);
      }
      if (!hitTest(point)) return null;
      return headHitRegion(point, displayed.anchors.head);
    },
    groupFacing() {
      return 1;
    },
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
    getAssetFailure() {
      return assetError ?? hitError;
    },
    retryAssetLoad,
    getMotionFailure() {
      return (
        failure ?? assetError ?? player.getMotionFailure() ?? rejectedReaction
      );
    },
    getMotionTransition() {
      return !failure &&
        !player.getMotionFailure() &&
        !rejectedReaction &&
        progress
        ? structuredClone(progress)
        : null;
    },
    rejectReactionPlayback(code) {
      rejectedReaction = code;
      progress = null;
    },
    acceptReactionPlayback() {
      rejectedReaction = null;
      lastTime = null;
    },
    cancelMotionPlayback() {
      player.cancelMotionPlayback();
      progress = null;
      lastTime = null;
      revision += 1;
      // Cancellation is not an explicit resource retry. Keep the failed clip
      // registered so the next idle draw cannot silently repeat its request.
      if (!failure) requested = null;
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
      if (id === scheme) {
        retryAssetLoad();
        return;
      }
      const generation = ++revision;
      lastTime = null;
      await base.setScheme(id, config);
      if (disposed || generation !== revision) return;
      scheme = base.scheme ?? id;
      // Do not start a fresh request for the previous failed scheme while
      // its replacement is still loading. Accept first, then allow retry.
      failure = null;
    },
    dispose() {
      disposed = true;
      revision += 1;
      images.clear();
      painted = null;
      // Release the backing store even while an obsolete decode retains this figure.
      canvas.width = canvas.height = 0;
      if (hitSurface) hitSurface.width = hitSurface.height = 0;
      hitSurface = null;
      hitContext = null;
      hitFailedImage = null;
      hitError = null;
      base.dispose?.();
    },
    draw(group, face, frame) {
      if (disposed) return;
      if (owner !== group) {
        group.replaceChildren(standing, object);
        owner = group;
      }
      if (rejectedReaction && !frame.locomotion && !wasPhysical) {
        // Do not request, decode or select a same-named atlas for a stage
        // that the reaction boundary refused. T/face still advance in core.
        lastTime = frame.t;
        progress = null;
        if (!displayed) {
          object.style.display = "none";
          base.draw(standing, face, {
            ...frame,
            mode: "idle",
            locomotion: null,
          });
          standing
            .querySelector("canvas")
            ?.setAttribute("data-pet-raster-active", "true");
        }
        return;
      }
      const clip = clipForFrame(frame);
      if (clip !== requested) {
        requested = clip;
        revision += 1;
        // A mode change (including automatic idle) is not a network retry.
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
      const grip = frame.heldPickupPoint ?? frame.gripPoint;
      const input: SequenceInput = {
        clip: initializing ? "idle" : clip,
        t: clock + dt,
        phase: frame.locomotion?.phase ?? frame.gait?.phase,
        ...(grip ? { grip } : {}),
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

      let invalid: SequenceFailure["reason"] | null = isTransitionContainer(
        sequences,
        clip,
      )
        ? "transition-container"
        : null;
      if (physical && !invalid) {
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
      const previousProgress = progress;
      let request: SequencePresentationRequest;
      let waitingForAssets = false;
      if (invalid) request = { kind: "reject", reason: invalid };
      else if (!load(clip)) {
        waitingForAssets = true;
        progress = failure
          ? null
          : { id: `sequence-assets:${scheme}:${clip}`, progress: 0 };
        request = { kind: "hold" };
      } else request = { kind: "sample" };
      let sample: SequenceSample | null;
      try {
        sample = player.present(
          invalid ? { ...input, clip } : input,
          request,
          (sample) => {
            if (!sample) {
              if (!waitingForAssets) progress = null;
              return false;
            }
            if (
              (waitingForAssets || sample.motionFailure) &&
              displayed &&
              sample.translation.every(
                (value, axis) => value === displayed!.translation[axis],
              )
            ) {
              if (sample.motionFailure) progress = null;
              return false;
            }
            const image = images.get(keyOf(sample.frame.texture));
            if (!image) {
              // Never report or commit progress for an unpainted cel.
              progress = {
                id: `sequence-assets:${scheme}:${clip}`,
                progress: 0,
              };
              return false;
            }
            const samePixels =
              painted?.image === image &&
              painted.scheme === scheme &&
              painted.width === canvas.width &&
              painted.height === canvas.height &&
              painted.rect.every(
                (value, axis) => value === sample.frame.rect[axis],
              );
            try {
              if (!samePixels) {
                // A failed clear/draw must never certify the previous bitmap as intact.
                painted = null;
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(
                  image,
                  ...sample.frame.rect,
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                );
              }
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
              if (!samePixels)
                painted = {
                  image,
                  rect: [...sample.frame.rect],
                  width: canvas.width,
                  height: canvas.height,
                  scheme,
                };
            } catch (error: unknown) {
              // DOM failures invalidate certification too, without replacing their exception.
              painted = null;
              throw error;
            }
            // The clock commits with the installed cel, before retirement/feedback.
            if (!waitingForAssets && !sample.motionFailure) clock += dt;
            return true;
          },
        );
      } catch (error: unknown) {
        progress = previousProgress;
        throw error;
      }
      if (!sample) return;
      if (waitingForAssets) {
        progress =
          failure || sample.motionFailure
            ? null
            : { id: `sequence-assets:${scheme}:${clip}`, progress: 0 };
        return;
      }
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
      if (
        !waitingForAssets &&
        !failure &&
        !sample.motionFailure &&
        !rejectedReaction
      ) {
        assetError = null;
        base.releaseRenderSurface?.();
      }
    },
  };
}
