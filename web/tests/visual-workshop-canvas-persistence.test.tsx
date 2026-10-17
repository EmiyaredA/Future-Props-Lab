import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import {
  putVisualCanvas,
  type VisualCanvasDocument,
} from "@features/visual-workshop/api";
import { useCanvasPersistence } from "@features/visual-workshop/canvas/useCanvasPersistence";

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
