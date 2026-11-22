import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import {
  putVisualCanvas,
  type VisualCanvasDocument,
} from "@features/visual-workshop/api";
import { useCanvasPersistence } from "@features/visual-workshop/canvas/useCanvasPersistence";
import {
  registerReferenceImage,
  type ReferenceImageResult,
} from "@features/visual-workshop/creative/api";
vi.mock("@features/visual-workshop/creative/api", () => ({
  registerReferenceImage: vi.fn(),
}));

vi.mock("@features/visual-workshop/api", () => ({ putVisualCanvas: vi.fn() }));

const canvas: VisualCanvasDocument = {
  project_id: "project",
  revision: 0,
  updated_at: "2026-10-08T00:00:00Z",
  edges: [],
  nodes: [
    { id: "video", kind: "video", title: "视频", position: { x: 0, y: 0 } },
  ],
};

beforeEach(() => {
  vi.mocked(registerReferenceImage).mockReset();
  vi.useFakeTimers();
  vi.mocked(putVisualCanvas)
    .mockReset()
    .mockImplementation(async (_id, nodes, revision, edges) => ({
      ...canvas,
      nodes,
      edges: edges ?? [],
      revision: revision + 1,
    }));
});
afterEach(() => vi.useRealTimers());

function renderPersistence() {
  return renderHook(() => useCanvasPersistence("project", canvas), {
    wrapper: StrictMode,
  });
}

test("image registration preserves edits and newly collected cards in saves queued during registration", async () => {
  let finish!: (result: ReferenceImageResult) => void;
  vi.mocked(registerReferenceImage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useCanvasPersistence("project", {
      ...canvas,
      project_card_ids: ["existing"],
    }),
  );
  let registering!: Promise<ReferenceImageResult>;
  await act(async () => {
    registering = result.current.registerReferenceImage({
      request_id: "request",
      asset_id: "uploaded",
      kind: "scene",
      title: "森林",
    });
    await Promise.resolve();
  });
  expect(registerReferenceImage).toHaveBeenCalledOnce();
  act(() =>
    result.current.patchNode("video", { title: "登记期间修改的镜头" }, true),
  );
  await act(async () => {
    finish({
      card: {
        id: "new-card",
        title: "森林",
        kind: "scene",
        revision: 0,
        adopted_asset_id: "uploaded",
        archived: false,
        design: "",
      },
      project_card_ids: ["existing", "new-card"],
      revision: 1,
      reused: false,
    });
    await registering;
    await result.current.prepareCanvasForAgent();
  });
  expect(putVisualCanvas).toHaveBeenLastCalledWith(
    "project",
    expect.arrayContaining([
      expect.objectContaining({ title: "登记期间修改的镜头" }),
    ]),
    1,
    [],
    undefined,
    [],
    ["existing", "new-card"],
  );
  expect(result.current.readCanvas().projectCardIds).toEqual([
    "existing",
    "new-card",
  ]);
  expect(result.current.readCanvas().nodes[0].title).toBe("登记期间修改的镜头");
});

test.each([
  { kind: "success", receiptRevision: 1, expectedRevision: 7 },
  { kind: "success", receiptRevision: 8, expectedRevision: 8 },
  { kind: "conflict", receiptRevision: 3, expectedRevision: 7 },
  { kind: "network", receiptRevision: 0, expectedRevision: 7 },
])(
  "a late $kind receipt preserves the draft and newest conflict revision",
  async ({ kind, receiptRevision, expectedRevision }) => {
    let finish!: (value: VisualCanvasDocument) => void;
    let fail!: (error: unknown) => void;
    vi.mocked(putVisualCanvas).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const { result } = renderPersistence();
    await act(async () =>
      result.current.patchNode("video", { title: "local draft" }, true),
    );
    const remote = {
      ...canvas,
      revision: 7,
      nodes: [{ ...canvas.nodes[0], title: "newest server" }],
    };
    act(() => {
      result.current.applyServerCanvas({ ...remote, revision: 5 });
      result.current.applyServerCanvas(remote);
      result.current.applyServerCanvas({ ...remote, revision: 6 });
    });
    expect(result.current.conflict?.revision).toBe(7);
    const receipt = {
      ...canvas,
      revision: receiptRevision,
      nodes: [{ ...canvas.nodes[0], title: "save receipt" }],
    };
    await act(async () => {
      if (kind === "success") finish(receipt);
      else if (kind === "conflict")
        fail(new ApiError("conflict", { current: receipt }, 409));
      else fail(new Error("network failed"));
      await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
        "保存冲突",
      );
    });
    expect(result.current.conflict?.revision).toBe(expectedRevision);
    expect(result.current.saveState).toBe("conflict");
    expect(result.current.nodes[0].title).toBe("local draft");
    await act(() => result.current.resolveConflict("server"));
    expect(result.current.readCanvas().revision).toBe(expectedRevision);
    expect(result.current.nodes[0].title).toBe(
      expectedRevision === 8 ? "save receipt" : "newest server",
    );
    expect(await result.current.prepareCanvasForAgent()).toBe(expectedRevision);
  },
);

test("a local overwrite uses the newest conflict rather than an older 409 receipt", async () => {
  let fail!: (error: unknown) => void;
  vi.mocked(putVisualCanvas).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { result } = renderPersistence();
  await act(async () =>
    result.current.patchNode("video", { title: "keep local" }, true),
  );
  act(() => result.current.applyServerCanvas({ ...canvas, revision: 7 }));
  await act(async () => {
    fail(
      new ApiError(
        "old conflict",
        { current: { ...canvas, revision: 3 } },
        409,
      ),
    );
    await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
      "保存冲突",
    );
  });
  await act(() => result.current.resolveConflict("local"));
  expect(vi.mocked(putVisualCanvas).mock.calls[1][2]).toBe(7);
  expect(result.current.nodes[0].title).toBe("keep local");
  expect(await result.current.prepareCanvasForAgent()).toBe(8);
  expect(result.current.saveState).toBe("saved");
});

test("loading the server version clears a prior save error and cancels pending autosave", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(new Error("network failed"));
  const { result } = renderPersistence();
  await act(async () => {
    result.current.patchNode("video", { title: "local" }, true);
    await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
      "network failed",
    );
  });
  act(() => {
    result.current.patchNode("video", { title: "later edit" });
    result.current.applyServerCanvas({
      ...canvas,
      revision: 2,
      project_card_ids: ["server-card"],
    });
  });
  await act(() => result.current.resolveConflict("server"));
  expect(result.current.saveState).toBe("saved");
  expect(result.current.saveMessage).toBe("");
  expect(result.current.readCanvas()).toMatchObject({
    revision: 2,
    projectCardIds: ["server-card"],
  });
  expect(result.current.nodes[0].title).toBe("视频");
  expect(await result.current.prepareCanvasForAgent()).toBe(2);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
});

test("overwriting with the local version retries CAS using the conflict revision", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError("conflict", { current: { ...canvas, revision: 5 } }, 409),
  );
  const { result } = renderPersistence();
  await act(async () => {
    result.current.patchNode("video", { title: "keep local" }, true);
    await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
      "保存冲突",
    );
  });
  await act(() => result.current.resolveConflict("local"));
  expect(vi.mocked(putVisualCanvas).mock.calls[1][2]).toBe(5);
  expect(result.current.nodes[0].title).toBe("keep local");
  expect(result.current.saveState).toBe("saved");
  expect(await result.current.prepareCanvasForAgent()).toBe(6);
});

test("resolving a conflict drains old saves before loading the latest server snapshot", async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(putVisualCanvas).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result } = renderPersistence();
  await act(async () =>
    result.current.patchNode("video", { title: "in flight" }, true),
  );
  let resolving!: Promise<void>;
  act(() => {
    result.current.patchNode("video", { title: "queued" }, true);
    result.current.applyServerCanvas({ ...canvas, revision: 2 });
    resolving = result.current.resolveConflict("server");
  });
  await act(async () => {
    reject(
      new ApiError("conflict", { current: { ...canvas, revision: 3 } }, 409),
    );
    await resolving;
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  expect(await result.current.prepareCanvasForAgent()).toBe(3);
  expect(result.current.nodes[0].title).toBe("视频");
});

test("generation preparation includes the draft save queued in the same React event", async () => {
  const { result } = renderPersistence();
  let submittedRevision = -1;
  await act(async () => {
    result.current.setSaveState("saving");
    result.current.patchNode("video", { title: "新提示词草稿" }, true);
    submittedRevision = await result.current.prepareCanvasForAgent();
  });
  expect(submittedRevision).toBe(1);
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  expect(vi.mocked(putVisualCanvas).mock.calls[0][1][0].title).toBe(
    "新提示词草稿",
  );
  expect(result.current.revisionRef.current).toBe(submittedRevision);
});

test("completed autosave leaves no timer that saves again during generation preparation", async () => {
  const { result } = renderPersistence();
  act(() => result.current.patchNode("video", { title: "新提示词草稿" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.prepareCanvasForAgent();
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(1);
  expect(result.current.autoSave.current).toBeUndefined();
});

test("immediate node and edge saves cancel the pending debounce without dropping either change", async () => {
  const { result } = renderPersistence();
  act(() => result.current.patchNode("video", { title: "新提示词草稿" }));
  await act(async () => {
    result.current.patchNode("video", { position: { x: 20, y: 30 } }, true);
    result.current.replaceEdges(
      [{ id: "edge", source_node_id: "source", target_node_id: "video" }],
      true,
    );
    await result.current.prepareCanvasForAgent();
  });
  expect(result.current.autoSave.current).toBeUndefined();
  expect(result.current.nodesRef.current[0]).toMatchObject({
    title: "新提示词草稿",
    position: { x: 20, y: 30 },
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(2);
  expect(result.current.revisionRef.current).toBe(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(2);
});

test("a real version conflict preserves the draft and prevents generation preparation", async () => {
  const current = { ...canvas, revision: 5 };
  vi.mocked(putVisualCanvas).mockRejectedValue(
    new ApiError("版本冲突", { current }, 409),
  );
  const { result } = renderPersistence();
  await act(async () => {
    result.current.patchNode("video", { title: "本地草稿" }, true);
    await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
      "画布存在保存冲突",
    );
  });
  expect(result.current.conflict).toEqual(current);
  expect(result.current.nodesRef.current[0].title).toBe("本地草稿");
  expect(result.current.saveState).toBe("conflict");
});

test("preparation drains edits queued while an earlier save is in flight", async () => {
  let finishFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_id, nodes, revision, edges) => {
      if (revision === 0) await first;
      return { ...canvas, nodes, edges: edges ?? [], revision: revision + 1 };
    },
  );
  const { result } = renderPersistence();
  let preparation!: Promise<number>;
  act(() => {
    result.current.patchNode("video", { title: "第一次修改" }, true);
    preparation = result.current.prepareCanvasForAgent();
  });
  await act(async () => {
    await Promise.resolve();
    result.current.patchNode("video", { title: "等待保存期间的修改" });
    finishFirst();
    expect(await preparation).toBe(2);
  });
  expect(putVisualCanvas).toHaveBeenCalledTimes(2);
  expect(vi.mocked(putVisualCanvas).mock.calls[1][1][0].title).toBe(
    "等待保存期间的修改",
  );
  expect(result.current.autoSave.current).toBeUndefined();
});

test("debounced edits immediately report saving and failed saves block generation", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValue(new Error("网络中断"));
  const { result } = renderPersistence();
  act(() => result.current.patchNode("video", { title: "未保存草稿" }));
  expect(result.current.saveState).toBe("saving");
  await act(async () => {
    await expect(result.current.prepareCanvasForAgent()).rejects.toThrow(
      "画布尚未保存：网络中断",
    );
  });
  expect(result.current.nodesRef.current[0].title).toBe("未保存草稿");
  expect(result.current.saveState).toBe("error");
});

test("polling the same revision preserves edits waiting for autosave", () => {
  const { result } = renderPersistence();
  act(() => result.current.patchNode("video", { title: "尚未保存的草稿" }));
  act(() => result.current.applyServerCanvas({ ...canvas }));
  expect(result.current.nodesRef.current[0].title).toBe("尚未保存的草稿");
  expect(result.current.conflict).toBeUndefined();
});

test("a late polling snapshot cannot roll back a completed save or flag the next edit as a conflict", async () => {
  const { result } = renderPersistence();
  await act(async () => {
    result.current.patchNode("video", { title: "已保存的新草稿" }, true);
    await result.current.prepareCanvasForAgent();
  });
  act(() => result.current.applyServerCanvas({ ...canvas }));
  expect(result.current.revisionRef.current).toBe(1);
  expect(result.current.nodesRef.current[0].title).toBe("已保存的新草稿");
  act(() => {
    result.current.patchNode("video", { title: "下一次编辑" });
    result.current.applyServerCanvas({ ...canvas });
  });
  expect(result.current.conflict).toBeUndefined();
  expect(result.current.nodesRef.current[0].title).toBe("下一次编辑");
});

test("a newer polling snapshot still exposes a real conflict without dropping local edits", () => {
  const { result } = renderPersistence();
  act(() => {
    result.current.patchNode("video", { title: "本地尚未保存" });
    result.current.applyServerCanvas({ ...canvas, revision: 2 });
  });
  expect(result.current.conflict?.revision).toBe(2);
  expect(result.current.saveState).toBe("conflict");
  expect(result.current.nodesRef.current[0].title).toBe("本地尚未保存");
});

test("approval persists immediately, survives reload, and clears on content replacement", async () => {
  const { result } = renderPersistence();
  await act(async () => {
    result.current.patchNode("video", { approved: true }, true);
    await result.current.prepareCanvasForAgent();
  });
  expect(vi.mocked(putVisualCanvas).mock.calls[0][1][0].approved).toBe(true);
  act(() =>
    result.current.applyServerCanvas({
      ...canvas,
      revision: 2,
      nodes: result.current.nodes,
    }),
  );
  expect(result.current.nodes[0].approved).toBe(true);
  await act(async () => {
    result.current.patchNode("video", { title: "新名称" }, true);
    await result.current.prepareCanvasForAgent();
  });
  expect(result.current.nodes[0].approved).toBe(true);
  await act(async () => {
    result.current.patchNode("video", { asset_id: "new-result" }, true);
    await result.current.prepareCanvasForAgent();
  });
  expect(result.current.nodes[0].approved).toBe(false);
});
