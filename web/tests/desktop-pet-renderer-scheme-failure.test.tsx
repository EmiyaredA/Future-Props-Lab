import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PetDocument } from "../src/features/desktop-pet/api";
import { WhaleRenderer } from "../src/features/desktop-pet/WhaleRenderer";

const factories = vi.hoisted(() => ({ human: vi.fn(), pet: vi.fn() }));
vi.mock("../src/features/desktop-pet/humanFigure", () => ({
  createHumanFigure: factories.human,
}));
vi.mock("../src/features/desktop-pet/whale-vendor/pet-core.js", () => ({
  createPet: factories.pet,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function sourceFigure() {
  const pending: { id: string; task: ReturnType<typeof deferred> }[] = [];
  let scheme = "classic";
  return {
    get scheme() {
      return scheme;
    },
    setScheme: vi.fn((id: string) => {
      const task = deferred();
      pending.push({ id, task });
      return task.promise.then(() => {
        scheme = id;
      });
    }),
    pending,
    dispose: vi.fn(),
    draw: vi.fn(),
    reset: vi.fn(),
    preload: vi.fn(async () => {}),
  };
}

function document(sequence: boolean, revision = 1): PetDocument {
  const sequences = {
    version: 1,
    frameSize: [10, 20],
    modelBox: [0, 0, 10, 20],
    headLength: 10,
    clips: {
      idle: {
        loop: true,
        frames: [
          {
            texture: "whole",
            rect: [0, 0, 10, 20],
            durationMs: 400,
            grip: [5, 10],
            foot: [5, 19],
            head: [
              [5, 1],
              [5, 11],
            ],
          },
        ],
      },
    },
    transitions: [],
  };
  return {
    revision,
    sourceRevision: revision,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      rigProfile: "human-chibi",
      identity: revision,
      schemes: [{ id: "classic" }, { id: "lab" }, { id: "maid" }],
      ...(sequence ? { frameSequences: sequences } : {}),
    },
    whaleAssets: {},
    assetUrls: {},
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      schemeId: "classic",
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

beforeEach(() => {
  factories.human.mockReset();
  factories.pet.mockReset();
  factories.pet.mockImplementation(() => ({
    replaceReaction: vi.fn(),
    setLocomotion: vi.fn(),
    step: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
  }));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    })) as unknown as HTMLCanvasElement["getContext"],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function finish(task: ReturnType<typeof deferred>, error?: string) {
  await act(async () => {
    if (error) task.reject(new Error(error));
    else task.resolve();
  });
}

for (const sequence of [false, true]) {
  const kind = sequence ? "production sequence wrapper" : "direct human";

  test(`${kind}: failed selection shows an alert, reselecting succeeds without rebuilding or removing the drawn stage`, async () => {
    const source = sourceFigure();
    factories.human.mockResolvedValue(source);
    const doc = document(sequence);
    const view = render(<WhaleRenderer document={doc} skinId="classic" />);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    const stage = view.container.querySelector("svg")!;
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    await finish(source.pending[0].task, "人物桌宠贴图无法加载");
    expect(screen.getByRole("alert")).toHaveTextContent("人物桌宠贴图无法加载");
    expect(source.scheme).toBe("classic");
    expect(view.container.querySelector("svg")).toBe(stage);
    expect(source.dispose).not.toHaveBeenCalled();
    view.rerender(<WhaleRenderer document={doc} skinId="classic" />);
    if (!sequence) await finish(source.pending.at(-1)!.task);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    await finish(source.pending.at(-1)!.task);
    expect(source.scheme).toBe("lab");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(factories.human).toHaveBeenCalledOnce();
    expect(factories.pet).toHaveBeenCalledOnce();
    expect(view.container.querySelector("svg")).toBe(stage);
  });

  test(`${kind}: an older failed selection cannot contaminate a newer success`, async () => {
    const source = sourceFigure();
    factories.human.mockResolvedValue(source);
    const doc = document(sequence);
    const view = render(<WhaleRenderer document={doc} skinId="classic" />);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    const old = source.pending.at(-1)!.task;
    view.rerender(<WhaleRenderer document={doc} skinId="maid" />);
    await finish(source.pending.at(-1)!.task);
    await finish(old, "旧选择失败");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(source.scheme).toBe("maid");
  });

  test(`${kind}: an older successful selection cannot clear the current failure`, async () => {
    const source = sourceFigure();
    factories.human.mockResolvedValue(source);
    const doc = document(sequence);
    const view = render(<WhaleRenderer document={doc} skinId="classic" />);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    const old = source.pending.at(-1)!.task;
    view.rerender(<WhaleRenderer document={doc} skinId="maid" />);
    await finish(source.pending.at(-1)!.task, "当前选择失败");
    await finish(old);
    expect(screen.getByRole("alert")).toHaveTextContent("当前选择失败");
  });

  test(`${kind}: unmounting catches pending rejection without changing another renderer`, async () => {
    const source = sourceFigure();
    factories.human.mockResolvedValue(source);
    const doc = document(sequence);
    const view = render(<WhaleRenderer document={doc} skinId="classic" />);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    const pending = source.pending.at(-1)!.task;
    view.unmount();
    expect(source.dispose).toHaveBeenCalledOnce();
    await finish(pending, "卸载后失败");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test(`${kind}: pending callbacks from a replaced resource cannot alter the new renderer error`, async () => {
    const source = sourceFigure();
    const next = sourceFigure();
    factories.human.mockResolvedValueOnce(source).mockResolvedValueOnce(next);
    const view = render(
      <WhaleRenderer document={document(sequence)} skinId="classic" />,
    );
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    view.rerender(<WhaleRenderer document={document(sequence)} skinId="lab" />);
    const old = source.pending.at(-1)!.task;
    const replacement = document(sequence, 2);
    view.rerender(<WhaleRenderer document={replacement} skinId="classic" />);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledTimes(2));
    view.rerender(<WhaleRenderer document={replacement} skinId="maid" />);
    await finish(next.pending.at(-1)!.task, "新实例失败");
    await finish(old, "旧实例失败");
    expect(screen.getByRole("alert")).toHaveTextContent("新实例失败");
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
  });

  test(`${kind}: a changed selection while creation is pending uses the same guarded failure handler`, async () => {
    const created = deferred();
    const source = sourceFigure();
    factories.human.mockImplementation(() =>
      created.promise.then(() => source),
    );
    const doc = document(sequence);
    const view = render(<WhaleRenderer document={doc} skinId="classic" />);
    view.rerender(<WhaleRenderer document={doc} skinId="lab" />);
    await finish(created);
    await waitFor(() => expect(factories.pet).toHaveBeenCalledOnce());
    expect(source.pending.at(-1)?.id).toBe("lab");
    await finish(source.pending.at(-1)!.task, "初始化期间换装失败");
    expect(screen.getByRole("alert")).toHaveTextContent("初始化期间换装失败");
    expect(source.dispose).not.toHaveBeenCalled();
  });
}
