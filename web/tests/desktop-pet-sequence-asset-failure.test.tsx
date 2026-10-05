import { createRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useEditorPreview } from "@features/desktop-pet/useEditorPreview";
import { WhaleRenderer } from "@features/desktop-pet/WhaleRenderer";
import type { PetDocument } from "@features/desktop-pet/api";
import type { HumanModel } from "@features/desktop-pet/humanFigure";
import type { PetRendererHandle } from "@features/desktop-pet/PetRenderer";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type { FrameSequences } from "@features/desktop-pet/sequences/types";

// Real component -> human/rig -> sequence -> pet-core. Browser surfaces are
// controlled; these assertions are not native GPU/OS or art acceptance.
const model: HumanModel = {
  rigProfile: "human-chibi",
  character: { name: "asset failure fixture" },
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
  schemes: [{ id: "classic" }, { id: "lab" }],
};
const cel = (texture = "whole") => ({
  texture,
  rect: [0, 0, 100, 200] as [number, number, number, number],
  durationMs: 400,
  grip: [50, 70] as [number, number],
  foot: [50, 190] as [number, number],
  head: [
    [50, 10],
    [50, 50],
  ] as [[number, number], [number, number]],
});
const sequences = (): FrameSequences => ({
  version: 1,
  frameSize: [100, 200],
  modelBox: [0, 0, 50, 100],
  headLength: 20,
  clips: { idle: { frames: [cel()], loop: true } },
  transitions: [],
});
function fixture(revision = 1): PetDocument {
  const paths = [
    "tex/atlas.png",
    "feat/eyes.png",
    "tex/whole.png",
    "schemes/lab/tex/atlas.png",
    "schemes/lab/feat/eyes.png",
    "schemes/lab/tex/whole.png",
  ];
  return {
    revision,
    sourceRevision: revision,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: { ...model, frameSequences: sequences() },
    whaleAssets: Object.fromEntries(paths.map((path) => [path, path])),
    assetUrls: Object.fromEntries(
      paths.map((path) => [path, `/r${revision}/${path}`]),
    ),
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      schemeId: "classic",
      events: {
        idle: { motionId: null, expressionId: null, sound: "none" },
        click: { motionId: null, expressionId: null, sound: "none" },
      },
      habits: {
        size: 220,
        roam: "off",
        draggable: true,
        edgeClimbing: true,
        highGliding: true,
        sound: false,
        bubbles: false,
        hoverActions: [],
      },
    },
  };
}
function deferred() {
  let resolve!: () => void, reject!: (cause: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let now: number, raf: FrameRequestCallback | null;
let requests: string[],
  rejected: Map<string, string>,
  holds: Map<string, ReturnType<typeof deferred>>,
  dimensions: Map<string, [number, number]>;
let paints: { src: string; args: number[] }[],
  gpu: { releases: number; draws: number; canvas: HTMLCanvasElement }[];
class Raster {
  width = 100;
  height = 200;
  naturalWidth = 100;
  naturalHeight = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = "";
  set src(value: string) {
    this.url = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.url;
  }
  async decode() {
    requests.push(this.src);
    const shape = dimensions.get(this.src);
    if (shape) [this.naturalWidth, this.naturalHeight] = shape;
    const failure = rejected.get(this.src);
    if (failure) throw new Error(failure);
    await holds.get(this.src)?.promise;
  }
}
beforeEach(() => {
  now = 0;
  raf = null;
  requests = [];
  rejected = new Map();
  holds = new Map();
  dimensions = new Map();
  paints = [];
  gpu = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("Image", Raster);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    raf = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d")
        return new Proxy(
          {},
          {
            get: (_, key) =>
              key === "drawImage"
                ? (image: Raster, ...args: number[]) =>
                    paints.push({ src: image.src ?? "face", args })
                : key === "createRadialGradient"
                  ? () => ({ addColorStop: vi.fn() })
                  : vi.fn(),
          },
        );
      const row = { releases: 0, draws: 0, canvas: this };
      gpu.push(row);
      return new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "canvas") return this;
            if (key === "getExtension")
              return () => ({ loseContext: () => row.releases++ });
            if (key === "getShaderParameter" || key === "getProgramParameter")
              return () => true;
            if (key === "drawElements") return () => row.draws++;
            return vi.fn(() => ({}));
          },
        },
      );
    } as unknown as HTMLCanvasElement["getContext"],
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function advance(seconds = 0.05) {
  await act(async () => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) {
      now += 1000 / 60;
      raf?.(now);
      await settle();
    }
  });
}
const whole = (revision = 1) => `/r${revision}/tex/whole.png`;
const wholePaints = () => paints.filter((p) => p.src.endsWith("/whole.png"));
async function ready() {
  await act(settle);
  await waitFor(() => expect(raf).not.toBeNull());
  await advance();
}

for (const mode of ["inspect", "runtime"] as const) {
  test(`${mode}: first whole decode failure shows original alert and preserves real standing surface`, async () => {
    rejected.set(whole(), "native-image-error-original");
    const ref = createRef<PetRendererHandle>();
    const view = render(
      <WhaleRenderer ref={ref} document={fixture()} playbackMode={mode} />,
    );
    await ready();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "native-image-error-original",
    );
    expect(ref.current?.motionFailure?.()).toBe("native-image-error-original");
    expect(wholePaints()).toHaveLength(0);
    expect(gpu).toHaveLength(1);
    expect(gpu[0].releases).toBe(0);
    expect(gpu[0].draws).toBeGreaterThan(0);
    expect(
      view.container.querySelector('canvas[data-pet-raster-active="true"]'),
    ).toBe(gpu[0].canvas);
    view.unmount();
    expect(gpu[0].releases).toBe(1);
  });
}
test("bounds validation error is original visible resource failure, not a missing pose warning", async () => {
  dimensions.set(whole(), [50, 100]);
  render(<WhaleRenderer document={fixture()} />);
  await ready();
  expect(screen.getByRole("alert")).toHaveTextContent("完整序列帧资源无效");
  expect(wholePaints()).toHaveLength(0);
  expect(gpu[0].releases).toBe(0);
});
test("authorized path lookup failure shows its exact message", async () => {
  const doc = fixture();
  delete doc.whaleAssets!["tex/whole.png"];
  render(<WhaleRenderer document={doc} />);
  await ready();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "桌宠贴图缺失：tex/whole.png",
  );
  expect(requests).toHaveLength(0);
});
test("ordinary ticks, same props/menu rerender and cancellation do not repeat a failed PNG", async () => {
  rejected.set(whole(), "initial-failure");
  const doc = fixture(),
    ref = createRef<PetRendererHandle>();
  const view = render(<WhaleRenderer ref={ref} document={doc} />);
  await ready();
  await advance(1);
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={{ ...doc, config: { ...doc.config } }}
    />,
  );
  act(() => ref.current?.cancelMotionPlayback?.());
  await advance(1);
  expect(requests).toEqual([whole()]);
  expect(screen.getByRole("alert")).toHaveTextContent("initial-failure");
  expect(gpu[0].releases).toBe(0);
});
test("1800ms full-event automatic idle is not an explicit retry", async () => {
  rejected.set(whole(), "event-first-failure");
  render(
    <WhaleRenderer
      document={fixture()}
      eventName="click"
      playbackMode="event"
    />,
  );
  await ready();
  await advance(2.2);
  expect(requests).toEqual([whole()]);
  expect(screen.getByRole("alert")).toHaveTextContent("event-first-failure");
  expect(wholePaints()).toHaveLength(0);
  expect(gpu[0].releases).toBe(0);
});
for (const input of ["replay", "event", "mode", "signature"] as const) {
  test(`explicit ${input} retries but retains original alert while decoding until actual whole commit`, async () => {
    rejected.set(whole(), "keep-error-until-painted");
    const doc = fixture();
    const view = render(
      <WhaleRenderer document={doc} playbackMode="inspect" />,
    );
    await ready();
    rejected.clear();
    const pending = deferred();
    holds.set(whole(), pending);
    const next =
      input === "signature"
        ? {
            ...doc,
            config: {
              ...doc.config,
              events: {
                ...doc.config.events,
                idle: {
                  motionId: null,
                  expressionId: null,
                  sound: "tap" as const,
                },
              },
            },
          }
        : doc;
    view.rerender(
      <WhaleRenderer
        document={next}
        playbackMode={input === "mode" ? "event" : "inspect"}
        eventName={input === "event" ? "click" : "idle"}
        reactionKey={input === "replay" || input === "mode" ? 1 : 0}
      />,
    );
    await advance();
    expect(requests).toEqual([whole(), whole()]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "keep-error-until-painted",
    );
    expect(wholePaints()).toHaveLength(0);
    expect(gpu[0].releases).toBe(0);
    await act(async () => {
      pending.resolve();
      await settle();
    });
    // Decode completion alone has not painted/committed recovery.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "keep-error-until-painted",
    );
    await advance();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(wholePaints().length).toBeGreaterThan(0);
    expect(gpu[0].releases).toBe(1);
  });
}
test("unsupported old reaction cannot clear an asset error or revive legacy motion", async () => {
  rejected.set(whole(), "preserve-failed-resource");
  const doc = fixture(),
    ref = createRef<PetRendererHandle>();
  const view = render(<WhaleRenderer ref={ref} document={doc} />);
  await ready();
  const next = {
    ...doc,
    config: {
      ...doc.config,
      events: {
        ...doc.config.events,
        click: { motionId: "hop", expressionId: null, sound: "none" as const },
      },
    },
  };
  rejected.clear();
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={next}
      eventName="click"
      reactionKey={1}
    />,
  );
  await advance(0.2);
  expect(requests).toEqual([whole()]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "preserve-failed-resource",
  );
  expect(wholePaints()).toHaveLength(0);
});
test("new scheme can recover an image failure without clearing UI before successful paint", async () => {
  rejected.set(whole(), "classic-first-error");
  const doc = fixture();
  const view = render(<WhaleRenderer document={doc} skinId="classic" />);
  await ready();
  const pending = deferred();
  holds.set("/r1/schemes/lab/tex/whole.png", pending);
  view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
  await advance();
  expect(screen.getByRole("alert")).toHaveTextContent("classic-first-error");
  expect(gpu[0].releases).toBe(0);
  await act(async () => {
    pending.resolve();
    await settle();
  });
  await advance();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(wholePaints().at(-1)?.src).toBe("/r1/schemes/lab/tex/whole.png");
  expect(gpu[0].releases).toBe(1);
});
test("late failed decode of replaced resource cannot poison its successful replacement", async () => {
  const pending = deferred();
  holds.set(whole(), pending);
  const view = render(<WhaleRenderer document={fixture()} />);
  await ready();
  view.rerender(<WhaleRenderer document={fixture(2)} />);
  await ready();
  await act(async () => {
    pending.reject(new Error("obsolete-failure"));
    await settle();
  });
  await advance();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(wholePaints().at(-1)?.src).toBe(whole(2));
  expect(gpu.every((r) => r.releases === 1)).toBe(true);
});
test("old no-sequence human keeps its base renderer and does not gain image error feedback", async () => {
  const doc = fixture();
  delete doc.whaleModel!.frameSequences;
  render(<WhaleRenderer document={doc} />);
  await ready();
  expect(requests).toHaveLength(0);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(gpu).toHaveLength(1);
  expect(gpu[0].releases).toBe(0);
  expect(gpu[0].draws).toBeGreaterThan(0);
});
test("asset getter does not conflate pose failure, cancel preserves failures, explicit reset recovers", async () => {
  const pack = sequences();
  const source = {
    fixedScale: true,
    scheme: "classic",
    setScheme: async () => {},
    draw: () => {},
    reset: () => {},
  };
  const f = createSequenceFigure({
    base: source,
    sequences: pack,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (p) => `/r1/${p}`,
  });
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g"),
    frame = (t: number, mode = "idle") => ({
      t,
      mode,
      look: [0, 0],
      legs: [],
      swing: 0,
      sit: 0,
    });
  rejected.set(whole(), "direct-failure");
  f.draw(g, { eyes: [], gap: [] }, frame(0));
  await f.preload();
  expect(f.getAssetFailure?.()).toBe("direct-failure");
  f.cancelMotionPlayback?.();
  f.draw(g, { eyes: [], gap: [] }, frame(1, "held"));
  await settle();
  expect(requests).toEqual([whole()]);
  expect(f.getAssetFailure?.()).toBe("direct-failure");
  rejected.clear();
  f.reset();
  expect(f.getAssetFailure?.()).toBe("direct-failure");
  f.draw(g, { eyes: [], gap: [] }, frame(2));
  await f.preload();
  f.draw(g, { eyes: [], gap: [] }, frame(2.1));
  expect(f.getAssetFailure?.()).toBeNull();
  f.draw(g, { eyes: [], gap: [] }, frame(2.2, "held"));
  await settle();
  f.draw(g, { eyes: [], gap: [] }, frame(2.3, "held"));
  expect(f.getMotionFailure?.()).toContain("missing-clip");
  expect(f.getAssetFailure?.()).toBeNull();
  f.dispose?.();
});

test("later complete-image failure keeps the actual last whole cel and retired base until valid idle selection commits", async () => {
  const doc = fixture(),
    pack = sequences(),
    seated = cel("seated"),
    idle = pack.clips.idle.frames[0];
  pack.clips.sit = { loop: true, frames: [seated] };
  pack.clips.entry = { loop: false, frames: [idle, seated] };
  pack.clips.exit = { loop: false, frames: [seated, idle] };
  pack.transitions = [
    { id: "sit-entry", from: "idle", to: "sit", clip: "entry" },
    { id: "sit-exit", from: "sit", to: "idle", clip: "exit" },
  ];
  doc.whaleModel!.frameSequences = pack;
  doc.whaleAssets!["tex/seated.png"] = "seated";
  doc.assetUrls.seated = "/r1/tex/seated.png";
  doc.config.events!.click = {
    motionId: "sit",
    expressionId: null,
    sound: "none",
  };
  const ref = createRef<PetRendererHandle>(),
    view = render(<WhaleRenderer ref={ref} document={doc} />);
  await ready();
  const active = view.container.querySelector(
      'canvas[data-pet-raster-active="true"]',
    ),
    last = wholePaints().at(-1);
  expect(gpu[0].releases).toBe(1);
  rejected.set("/r1/tex/seated.png", "sit-original-decode-failure");
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={doc}
      eventName="click"
      reactionKey={1}
    />,
  );
  await advance(0.2);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "sit-original-decode-failure",
  );
  expect(wholePaints().at(-1)).toEqual(last);
  expect(
    view.container.querySelector('canvas[data-pet-raster-active="true"]'),
  ).toBe(active);
  expect(gpu).toHaveLength(1);
  act(() => ref.current?.cancelMotionPlayback?.());
  await advance(0.3);
  expect(requests.filter((p) => p.endsWith("/seated.png"))).toHaveLength(1);
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={doc}
      eventName="idle"
      reactionKey={2}
      playbackMode="inspect"
    />,
  );
  await advance();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(wholePaints().at(-1)?.src).toBe(whole());
  expect(gpu).toHaveLength(1);
});
test("late PNG rejection from an old scheme is ignored after accepting the replacement scheme", async () => {
  const pending = deferred();
  holds.set(whole(), pending);
  const doc = fixture();
  const view = render(<WhaleRenderer document={doc} skinId="classic" />);
  await ready();
  view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
  await advance();
  await act(async () => {
    pending.reject(new Error("obsolete-classic-decode"));
    await settle();
  });
  await advance();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(wholePaints().at(-1)?.src).toBe("/r1/schemes/lab/tex/whole.png");
  expect(requests.filter((p) => p === whole())).toHaveLength(1);
  expect(gpu[0].releases).toBe(1);
});
test("explicit same-scheme retry retains the resource error until real commit, without automatic request", async () => {
  const source = {
      fixedScale: true,
      scheme: "classic",
      setScheme: async () => {},
      draw: () => {},
      reset: () => {},
    },
    f = createSequenceFigure({
      base: source,
      sequences: sequences(),
      scheme: "classic",
      defaultScheme: "classic",
      asset: (p) => `/r1/${p}`,
    });
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g"),
    input = { t: 0, mode: "idle", look: [0, 0], legs: [], swing: 0, sit: 0 };
  rejected.set(whole(), "same-scheme-failure");
  f.draw(g, { eyes: [], gap: [] }, input);
  await f.preload();
  rejected.clear();
  await f.setScheme("classic");
  expect(f.getAssetFailure?.()).toBe("same-scheme-failure");
  expect(requests).toEqual([whole()]);
  f.draw(g, { eyes: [], gap: [] }, { ...input, t: 0.1 });
  await f.preload();
  expect(f.getAssetFailure?.()).toBe("same-scheme-failure");
  f.draw(g, { eyes: [], gap: [] }, { ...input, t: 0.2 });
  expect(f.getAssetFailure?.()).toBeNull();
  expect(requests).toEqual([whole(), whole()]);
  f.dispose?.();
});

function EditorTimerHarness({ doc }: { doc: PetDocument }) {
  const preview = useEditorPreview(doc, "events", "click");
  return (
    <>
      <button onClick={preview.playSelected}>play selected</button>
      <output
        data-testid="playback-identity"
        data-key={preview.key}
        data-mode={preview.mode}
        data-event={preview.eventName}
      />
      <WhaleRenderer
        document={doc}
        eventName={preview.eventName}
        playbackMode={preview.mode}
        reactionKey={preview.key}
      />
    </>
  );
}
test("real editor timer returns to idle/runtime with the same key and does not retry; another Play gets a new key and recovers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  rejected.set(whole(), "editor-timed-load-failure");
  render(<EditorTimerHarness doc={fixture()} />);
  await act(settle);
  expect(raf).not.toBeNull();
  await advance();
  expect(requests).toEqual([whole()]);
  const identity = screen.getByTestId("playback-identity");
  expect(identity).toHaveAttribute("data-mode", "inspect");
  fireEvent.click(screen.getByRole("button", { name: "play selected" }));
  await advance();
  const playKey = identity.getAttribute("data-key");
  expect(identity).toHaveAttribute("data-mode", "event");
  expect(requests).toEqual([whole(), whole()]);
  rejected.clear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2200);
  });
  await advance(2.2);
  expect(identity).toHaveAttribute("data-key", playKey!);
  expect(identity).toHaveAttribute("data-mode", "runtime");
  expect(identity).toHaveAttribute("data-event", "idle");
  expect(requests).toEqual([whole(), whole()]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "editor-timed-load-failure",
  );
  expect(wholePaints()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "play selected" }));
  await advance();
  expect(identity.getAttribute("data-key")).not.toBe(playKey);
  expect(requests).toEqual([whole(), whole(), whole()]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(wholePaints().length).toBeGreaterThan(0);
});
for (const event of ["idle", "roam", "chatThinking", "chatSpeaking"] as const) {
  test(`runtime automatic ${event} and its idle return cannot retry even with new keys`, async () => {
    rejected.set(whole(), "automatic-runtime-failure");
    const doc = fixture();
    doc.config.events!.roam = {
      motionId: null,
      expressionId: null,
      sound: "none",
    };
    const view = render(
      <WhaleRenderer document={doc} playbackMode="runtime" />,
    );
    await ready();
    rejected.clear();
    for (let key = 1; key <= 3; key++) {
      view.rerender(
        <WhaleRenderer
          document={doc}
          eventName={event}
          playbackMode="runtime"
          reactionKey={key * 2 - 1}
        />,
      );
      await advance();
      view.rerender(
        <WhaleRenderer
          document={doc}
          eventName="idle"
          playbackMode="runtime"
          reactionKey={key * 2}
        />,
      );
      await advance();
    }
    expect(requests).toEqual([whole()]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "automatic-runtime-failure",
    );
    expect(wholePaints()).toHaveLength(0);
    expect(gpu[0].releases).toBe(0);
  });
}
for (const event of ["click", "pet", "grab", "drop"] as const) {
  test(`runtime user ${event} with a new key may explicitly retry`, async () => {
    rejected.set(whole(), "manual-runtime-failure");
    const doc = fixture();
    doc.config.events![event] = {
      motionId: null,
      expressionId: null,
      sound: "none",
    };
    const view = render(
      <WhaleRenderer document={doc} playbackMode="runtime" />,
    );
    await ready();
    rejected.clear();
    // Name change alone is not a new deliberate gesture identity.
    view.rerender(
      <WhaleRenderer
        document={doc}
        eventName={event}
        playbackMode="runtime"
        reactionKey={0}
      />,
    );
    await advance();
    expect(requests).toEqual([whole()]);
    view.rerender(
      <WhaleRenderer
        document={doc}
        eventName={event}
        playbackMode="runtime"
        reactionKey={1}
      />,
    );
    await advance();
    expect(requests).toEqual([whole(), whole()]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(wholePaints().length).toBeGreaterThan(0);
  });
}
test("mode-only event input is not a new playback identity and runtime config changes do not imply retry", async () => {
  rejected.set(whole(), "identity-must-be-explicit");
  const doc = fixture();
  const view = render(<WhaleRenderer document={doc} playbackMode="inspect" />);
  await ready();
  rejected.clear();
  view.rerender(<WhaleRenderer document={doc} playbackMode="event" />);
  await advance();
  expect(requests).toEqual([whole()]);
  view.rerender(<WhaleRenderer document={doc} playbackMode="runtime" />);
  await advance();
  const next = {
    ...doc,
    config: {
      ...doc.config,
      events: {
        ...doc.config.events,
        idle: { motionId: null, expressionId: null, sound: "tap" as const },
      },
    },
  };
  view.rerender(
    <WhaleRenderer document={next} playbackMode="runtime" reactionKey={3} />,
  );
  await advance();
  expect(requests).toEqual([whole()]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "identity-must-be-explicit",
  );
});
