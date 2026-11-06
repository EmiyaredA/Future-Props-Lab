import { textClipOperations } from "@features/video-editor/textModel";
import { newTrack } from "@features/video-editor/editorModel";
import { describe, expect, it, vi } from "vitest";
import {
  TimelineSaveQueue,
  refreshUndo,
} from "@features/video-editor/timelineSaveQueue";
import type { VideoEditorTimeline } from "@features/video-editor/types";

const snapshot = (revision = 0): VideoEditorTimeline => ({
  projectId: "p",
  revision,
  document: {
    tracks: [],
    settings: {
      fps: 30,
      width: 1920,
      height: 1080,
      backgroundColor: "#000000",
    },
    schemaVersion: "1.0",
  },
  updatedAt: "now",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(initial = snapshot()) {
  let current = initial;
  const calls: {
    revision: number;
    operations: unknown[];
    result: ReturnType<typeof deferred<VideoEditorTimeline>>;
  }[] = [];
  const saved = vi.fn((next: VideoEditorTimeline) => {
    current = next;
  });
  const failed = vi.fn();
  const queue = new TimelineSaveQueue({
    read: () => current,
    write: (revision, operations) => {
      const result = deferred<VideoEditorTimeline>();
      calls.push({ revision, operations, result });
      return result.promise;
    },
    saved,
    failed,
    changed: vi.fn(),
  });
  return { queue, calls, saved, failed };
}
const edit = (fps: number) => (timeline: VideoEditorTimeline) => ({
  redo: [{ type: "updateSettings" as const, patch: { fps } }],
  undo: [
    {
      type: "updateSettings" as const,
      patch: { fps: timeline.document.settings?.fps },
    },
  ],
});

describe("timeline writes", () => {
  it("serializes writes and builds inverses against the preceding response", async () => {
    const { queue, calls } = fixture();
    const first = queue.enqueue("edit", edit(60));
    const second = queue.enqueue("edit", edit(30));
    expect(calls).toHaveLength(1);
    expect(queue.unsaved).toBe(true);
    calls[0].result.resolve({
      ...snapshot(1),
      document: {
        schemaVersion: "1.0",
        tracks: [],
        settings: { ...snapshot().document.settings!, fps: 60 },
      },
    });
    await first;
    expect(calls[1].revision).toBe(1);
    calls[1].result.resolve({
      ...snapshot(2),
      document: {
        schemaVersion: "1.0",
        tracks: [],
        settings: { ...snapshot().document.settings!, fps: 30 },
      },
    });
    await second;
    expect(queue.unsaved).toBe(false);
    const undo = queue.enqueue("undo");
    expect(calls[2].operations).toEqual([
      { type: "updateSettings", patch: { fps: 60 } },
    ]);
    calls[2].result.resolve({
      ...snapshot(3),
      document: {
        schemaVersion: "1.0",
        tracks: [],
        settings: { ...snapshot().document.settings!, fps: 60 },
      },
    });
    await undo;
    const redo = queue.enqueue("redo");
    expect(calls[3].revision).toBe(3);
    expect(calls[3].operations).toEqual([
      { type: "updateSettings", patch: { fps: 30 } },
    ]);
    calls[3].result.resolve(snapshot(4));
    await redo;
  });
  it("pauses without replay, retains failed intents until explicit discard", async () => {
    const { queue, calls, failed } = fixture();
    const first = queue.enqueue("edit", edit(60));
    const second = queue.enqueue("edit", edit(30));
    calls[0].result.reject(new Error("conflict"));
    await expect(first).rejects.toThrow("conflict");
    await expect(second).rejects.toThrow("conflict");
    expect(calls).toHaveLength(1);
    expect(failed).toHaveBeenCalledOnce();
    expect(queue.failedCount).toBe(2);
    expect(queue.unsaved).toBe(true);
    expect(queue.canUndo).toBe(false);
    await expect(queue.enqueue("edit", edit(60))).rejects.toThrow("未保存");
    expect(queue.discard()).toBe(true);
    expect(queue.unsaved).toBe(false);
  });
  it("isolates projects and ignores late responses after close", async () => {
    const first = fixture();
    const second = fixture();
    const pending = first.queue.enqueue("edit", edit(60));
    first.queue.close();
    first.calls[0].result.resolve(snapshot(1));
    await pending;
    expect(first.saved).not.toHaveBeenCalled();
    expect(second.calls).toHaveLength(0);
    expect(second.queue.unsaved).toBe(false);
  });
  it("captures settings before-values from the current committed snapshot", () => {
    expect(
      refreshUndo(snapshot(), [{ type: "updateSettings", patch: { fps: 10 } }]),
    ).toEqual([{ type: "updateSettings", patch: { fps: 30 } }]);
  });
});

it("undo of a queued clip edit restores the preceding successful value", async () => {
  const { clip } = textClipOperations([], 0, 30, "subtitle");
  const track = { ...newTrack("visual", 0), id: clip.trackId, clips: [clip] };
  const initial = {
    ...snapshot(),
    document: { ...snapshot().document, tracks: [track] },
  };
  const { queue, calls } = fixture(initial);
  const build = (volume: number) => (current: VideoEditorTimeline) => ({
    redo: [{ type: "updateClip" as const, clipId: clip.id, patch: { volume } }],
    undo: refreshUndo(current, [
      { type: "updateClip", clipId: clip.id, patch: { volume: clip.volume } },
    ]),
  });
  const first = queue.enqueue("edit", build(0.5));
  const second = queue.enqueue("edit", build(0.8));
  calls[0].result.resolve({
    ...initial,
    revision: 1,
    document: {
      ...initial.document,
      tracks: [{ ...track, clips: [{ ...clip, volume: 0.5 }] }],
    },
  });
  await first;
  calls[1].result.resolve({
    ...initial,
    revision: 2,
    document: {
      ...initial.document,
      tracks: [{ ...track, clips: [{ ...clip, volume: 0.8 }] }],
    },
  });
  await second;
  const undone = queue.enqueue("undo");
  expect(calls[2].operations).toEqual([
    { type: "updateClip", clipId: clip.id, patch: { volume: 0.5 } },
  ]);
  calls[2].result.resolve({ ...initial, revision: 3 });
  await undone;
});
