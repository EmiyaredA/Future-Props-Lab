import { afterEach, expect, test, vi } from "vitest";
import {
  createHumanFigure,
  type HumanModel,
  type HumanFrame,
} from "../src/features/desktop-pet/humanFigure";

const model: HumanModel = {
  rigProfile: "human-chibi",
  character: { name: "shared atlas fixture" },
  view: [0, 0, 100, 100],
  pivots: Object.fromEntries(
    ["body", "neck", "armNear", "armFar", "legBack", "legFront"].map((id) => [
      id,
      [50, 50],
    ]),
  ),
  parts: ["hair_back", "hair_front", "coat"].map((id, i) => ({
    id,
    tex: "atlas",
    parent: "body",
    box: [i * 10, 0, 10, 20],
    grid: [1, 1],
    uvBox: [i / 4, 0, (i + 1) / 4, 1],
    z: i,
  })),
  feat: { sprites: { eyes: [10, 10, 20, 20] } },
  schemes: [{ id: "classic" }, { id: "lab" }, { id: "maid" }],
};

const frame: HumanFrame = {
  t: 0,
  mode: "idle",
  face: "neutral",
  look: [0, 0],
  legs: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  low: 0,
  swing: 0,
  sit: 0,
  blink: 0,
  eyeClose: 0,
  talk: 0,
  tilt: 0,
  lean: 0,
};

function surfaces() {
  const requests: string[] = [];
  const waiting = new Map<string, () => void>();
  const paused = new Set<string>();
  let broken = "";
  class Image {
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      Object.defineProperty(this, "src", {
        get: () => this.url,
        set: (url: string) => {
          this.url = url;
          requests.push(url);
          const finish = () =>
            url === broken ? this.onerror?.() : this.onload?.();
          if ([...paused].some((prefix) => url.startsWith(prefix)))
            waiting.set(url, finish);
          else queueMicrotask(finish);
        },
      });
    }
    private url = "";
  }
  vi.stubGlobal("Image", Image);
  const uploads: { texture: object; source: { src?: string } }[] = [];
  const uv: number[][] = [];
  const vertices: number[][] = [];
  let texture: object = {};
  let textures = 0;
  let draws = 0;
  let lost = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d") return new Proxy({}, { get: () => vi.fn() });
      return new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "canvas") return this;
            if (key === "getExtension")
              return () => ({ loseContext: () => lost++ });
            if (key === "createTexture")
              return () => {
                textures++;
                return {};
              };
            if (key === "bindTexture")
              return (_: unknown, selected: object) => (texture = selected);
            if (key === "texImage2D")
              return (...args: unknown[]) =>
                uploads.push({ texture, source: args.at(-1) as Image });
            if (key === "bufferData")
              return (_: unknown, data: unknown) => {
                if (data instanceof Float32Array) uv.push([...data]);
              };
            if (key === "bufferSubData")
              return (_: unknown, _offset: unknown, data: Float32Array) =>
                vertices.push([...data]);
            if (key === "drawElements") return () => draws++;
            if (
              ["getShaderParameter", "getProgramParameter"].includes(
                String(key),
              )
            )
              return () => true;
            return vi.fn(() => ({}));
          },
        },
      );
    } as unknown as HTMLCanvasElement["getContext"],
  );
  return {
    requests,
    uploads,
    uv,
    vertices,
    paused,
    fail(url: string) {
      broken = url;
    },
    complete(prefix: string) {
      for (const [url, finish] of waiting)
        if (url.startsWith(prefix)) {
          waiting.delete(url);
          finish();
        }
    },
    counts: () => ({ textures, draws, lost }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const create = () =>
  createHumanFigure({ model, scheme: "classic", asset: (path) => path });

test("shared atlas loads/uploads once per scheme while all parts retain their independent crops and geometry", async () => {
  const original = structuredClone(model);
  const gpu = surfaces();
  const figure = await create();
  expect(gpu.requests).toEqual(["tex/atlas.png", "feat/eyes.png"]);
  expect(gpu.uploads.map((u) => u.source.src)).toEqual(["tex/atlas.png"]);
  const originalTexture = gpu.uploads[0].texture;
  expect(
    gpu.uv
      .slice(0, 3)
      .map((values) => [
        Math.min(...values.filter((_, i) => i % 2 === 0)),
        Math.max(...values.filter((_, i) => i % 2 === 0)),
      ]),
  ).toEqual([
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
  ]);
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  figure.draw(group, { blush: 0 }, frame);
  expect(gpu.counts().draws).toBe(4);
  expect(
    gpu.vertices
      .slice(0, 3)
      .map((points) => [
        Math.min(...points.filter((_, i) => i % 2 === 0)),
        Math.max(...points.filter((_, i) => i % 2 === 0)),
      ]),
  ).toEqual([
    [0, 10],
    [10, 20],
    [20, 30],
  ]);
  await figure.setScheme("lab");
  expect(gpu.uploads.at(-1)?.source.src).toBe("schemes/lab/tex/atlas.png");
  expect(gpu.uploads.at(-1)?.texture).toBe(originalTexture);
  await figure.setScheme("classic");
  expect(gpu.requests).toHaveLength(4);
  expect(gpu.uploads.at(-1)?.source.src).toBe("tex/atlas.png");
  expect(gpu.uploads.at(-1)?.texture).toBe(originalTexture);
  expect(model).toEqual(original);
  figure.dispose();
  expect(gpu.counts().lost).toBe(1);
});

test("a late scheme load cannot replace the more recent selection", async () => {
  const gpu = surfaces();
  const figure = await create();
  gpu.paused.add("schemes/lab/");
  const late = figure.setScheme("lab");
  await figure.setScheme("maid");
  const count = gpu.uploads.length;
  gpu.complete("schemes/lab/");
  await late;
  expect(figure.scheme).toBe("maid");
  expect(gpu.uploads).toHaveLength(count);
  expect(gpu.uploads.at(-1)?.source.src).toBe("schemes/maid/tex/atlas.png");
  figure.dispose();
});

test("disposing during a pending scheme load prevents later uploads", async () => {
  const gpu = surfaces();
  const figure = await create();
  gpu.paused.add("schemes/lab/");
  const late = figure.setScheme("lab");
  figure.dispose();
  const count = gpu.uploads.length;
  gpu.complete("schemes/lab/");
  await late;
  expect(gpu.uploads).toHaveLength(count);
  expect(figure.scheme).toBe("classic");
  expect(gpu.counts().lost).toBe(1);
});

test("loading failure retains the current scheme and existing failure feedback", async () => {
  const gpu = surfaces();
  const figure = await create();
  gpu.fail("schemes/lab/tex/atlas.png");
  await expect(figure.setScheme("lab")).rejects.toThrow("人物桌宠贴图无法加载");
  expect(figure.scheme).toBe("classic");
  expect(gpu.uploads).toHaveLength(1);
  const failedRequests = gpu.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gpu.requests).toHaveLength(failedRequests);
  gpu.fail("");
  await figure.setScheme("lab");
  expect(gpu.requests).toHaveLength(failedRequests + 2);
  expect(figure.scheme).toBe("lab");
  expect(gpu.uploads.at(-1)?.source.src).toBe("schemes/lab/tex/atlas.png");
  const recoveredRequests = gpu.requests.length;
  await figure.setScheme("lab");
  expect(gpu.requests).toHaveLength(recoveredRequests);
  figure.dispose();
});

function motionModel(version: 1 | 2 = 1): HumanModel {
  const candidate = structuredClone(model);
  const part = candidate.parts[0];
  candidate.parts.push(
    { ...part, id: "sit_lower", tex: "seated" },
    { ...part, id: "preserved_part", tex: "motion_profile_shared" },
    { ...part, id: "side_head", tex: "exclusive_profile" },
  );
  candidate.feat.sprites.unused_feature = [0, 0, 1, 1];
  candidate.motionRig = {
    version,
    hiddenParts: ["coat"],
    waist: [50, 50],
    limbs: Object.fromEntries(
      ["armNear", "armFar", "legBack", "legFront"].map((name) => {
        const ids = [0, 1, 2].map((index) => `${name}_piece_${index}`);
        candidate.parts.push(
          ...ids.map((id, index) => ({
            ...part,
            id,
            tex: index === 1 ? "exclusive_limb" : "atlas",
          })),
          { ...part, id: `${name}_cap`, tex: "exclusive_joint" },
        );
        return [
          name,
          {
            root: [40, 40],
            joint: [45, 50],
            end: [50, 65],
            parts: ids,
            jointPart: `${name}_cap`,
          },
        ];
      }),
    ) as NonNullable<HumanModel["motionRig"]>["limbs"],
    profileHead: {
      part: "side_head",
      hiddenParts: ["hair_front"],
      eye: [30, 30, 10, 10],
      brow: [30, 25, 10, 3],
      mouth: [35, 45, 4, 3],
    },
  };
  return candidate;
}

test("v1 only loads/uploads textures reachable by preserved standing and sitting parts across all outfits", async () => {
  const candidate = motionModel();
  const original = structuredClone(candidate);
  const gpu = surfaces();
  const figure = await createHumanFigure({
    model: candidate,
    scheme: "classic",
    asset: (path) => path,
  });
  const required = [
    "tex/atlas.png",
    "tex/seated.png",
    "tex/motion_profile_shared.png",
    "feat/eyes.png",
    "feat/unused_feature.png",
  ];
  expect(gpu.requests).toEqual(required);
  expect(gpu.uploads.map((upload) => upload.source.src)).toEqual(
    required.slice(0, 3),
  );
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  figure.draw(group, { blush: 0 }, frame);
  expect(gpu.counts().draws).toBe(5);
  const idleDraws = gpu.counts().draws;
  figure.draw(group, { blush: 0 }, { ...frame, mode: "sit", sit: 1 });
  expect(gpu.counts().draws - idleDraws).toBe(6);
  for (const scheme of ["lab", "maid"] as const) {
    await figure.setScheme(scheme);
    expect(gpu.requests.slice(-required.length)).toEqual(
      required.map((path) => `schemes/${scheme}/${path}`),
    );
    expect(gpu.uploads.slice(-3).map((upload) => upload.source.src)).toEqual(
      required.slice(0, 3).map((path) => `schemes/${scheme}/${path}`),
    );
  }
  await figure.setScheme("classic");
  expect(gpu.requests).toHaveLength(15);
  expect(candidate).toEqual(original);
  figure.dispose();
  expect(gpu.counts().lost).toBe(1);
});

test.each(["v2", "legacy"] as const)(
  "%s retains every part texture regardless of motion-like texture names",
  async (kind) => {
    const candidate = motionModel(2);
    if (kind === "legacy") delete candidate.motionRig;
    const gpu = surfaces();
    const figure = await createHumanFigure({
      model: candidate,
      scheme: "classic",
      asset: (path) => path,
    });
    expect(gpu.requests).toEqual([
      "tex/atlas.png",
      "tex/seated.png",
      "tex/motion_profile_shared.png",
      "tex/exclusive_profile.png",
      "tex/exclusive_limb.png",
      "tex/exclusive_joint.png",
      "feat/eyes.png",
      "feat/unused_feature.png",
    ]);
    expect(gpu.uploads).toHaveLength(6);
    figure.dispose();
  },
);

test("quarantined parts still undergo original registration validation before any runtime load", async () => {
  const candidate = motionModel();
  candidate.parts.find((part) => part.id === "side_head")!.restTransform = {
    angle: 20,
    pivot: [50, 50],
  };
  const gpu = surfaces();
  await expect(
    createHumanFigure({
      model: candidate,
      scheme: "classic",
      asset: (path) => path,
    }),
  ).rejects.toThrow("静态素材登记");
  expect(gpu.requests).toEqual([]);
  expect(gpu.uploads).toEqual([]);
});

test("a delayed old failure preserves the latest scheme and allows explicit retry", async () => {
  const gpu = surfaces();
  const figure = await create();
  gpu.paused.add("schemes/lab/");
  const old = figure.setScheme("lab");
  const rejected = expect(old).rejects.toThrow("人物桌宠贴图无法加载");
  await figure.setScheme("maid");
  const count = gpu.uploads.length;
  gpu.fail("schemes/lab/tex/atlas.png");
  gpu.complete("schemes/lab/");
  await rejected;
  expect(figure.scheme).toBe("maid");
  expect(gpu.uploads).toHaveLength(count);
  gpu.fail("");
  gpu.paused.delete("schemes/lab/");
  await figure.setScheme("lab");
  expect(figure.scheme).toBe("lab");
  const requests = gpu.requests.length;
  await figure.setScheme("maid");
  expect(gpu.requests).toHaveLength(requests);
  expect(figure.scheme).toBe("maid");
  figure.dispose();
});

test("an unawaited background selection failure is handled without automatic retry", async () => {
  const gpu = surfaces();
  const figure = await create();
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  process.on("unhandledRejection", unhandled);
  try {
    gpu.fail("schemes/lab/tex/atlas.png");
    void figure.setScheme("lab");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    expect(figure.scheme).toBe("classic");
    expect(gpu.requests).toHaveLength(4);
    expect(gpu.uploads).toHaveLength(1);
    gpu.fail("");
    await figure.setScheme("lab");
    expect(figure.scheme).toBe("lab");
  } finally {
    window.removeEventListener("unhandledrejection", unhandled);
    process.off("unhandledRejection", unhandled);
    figure.dispose();
  }
});
