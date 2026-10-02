import type { VideoEditorOperation, VideoEditorTimeline } from "./types";
import { reconcileAudioTransitionOperations } from "./audioTransitionOperations";

export type TimelineEdit = {
  redo: VideoEditorOperation[];
  undo: VideoEditorOperation[];
};
export type TimelineEditBuilder = (
  timeline: VideoEditorTimeline,
) => TimelineEdit;
type Intent = {
  kind: "edit" | "undo" | "redo";
  build?: TimelineEditBuilder;
  summary?: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Owns one project's writes and history; a failed intent is never replayed. */
export class TimelineSaveQueue {
  private pending: Intent[] = [];
  private retained: Intent[] = [];
  private undoEntries: TimelineEdit[] = [];
  private redoEntries: TimelineEdit[] = [];
  private running = false;
  private closed = false;
  private leases = 0;
  attach() {
    this.leases++;
    return () => {
      this.leases--;
      queueMicrotask(() => {
        if (!this.leases) this.close();
      });
    };
  }
  constructor(
    private readonly io: {
      read: () => VideoEditorTimeline | undefined;
      write: (
        revision: number,
        operations: VideoEditorOperation[],
      ) => Promise<VideoEditorTimeline>;
      saved: (timeline: VideoEditorTimeline) => void;
      failed: (error: unknown) => void;
      changed: () => void;
    },
  ) {}
  get busy() {
    return this.running;
  }
  get unsaved() {
    return this.running || this.pending.length > 0 || this.retained.length > 0;
  }
  get failedCount() {
    return this.retained.length;
  }
  get failedOperations() {
    return this.retained.map(
      (intent) =>
        intent.summary ?? (intent.kind === "edit" ? "待提交编辑" : intent.kind),
    );
  }
  get canUndo() {
    return !this.unsaved && this.undoEntries.length > 0;
  }
  get canRedo() {
    return !this.unsaved && this.redoEntries.length > 0;
  }
  enqueue(kind: Intent["kind"], build?: TimelineEditBuilder): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      if (this.closed || this.retained.length) {
        reject(new Error("请先处理未保存操作"));
        return;
      }
      this.pending.push({ kind, build, resolve, reject });
      void this.drain();
    });
    // Many UI entrypoints are fire-and-forget; callers can still await rejection.
    void promise.catch(() => {});
    return promise;
  }
  discard() {
    if (this.running) return false;
    this.retained = [];
    this.undoEntries = [];
    this.redoEntries = [];
    this.io.changed();
    return true;
  }
  close() {
    this.closed = true;
    for (const intent of this.pending) intent.reject(new Error("编辑器已关闭"));
    this.pending = [];
  }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    this.io.changed();
    while (this.pending.length && !this.closed) {
      const intent = this.pending.shift()!;
      try {
        const current = this.io.read();
        if (!current) throw new Error("时间轴尚未就绪");
        const entry =
          intent.kind === "edit"
            ? intent.build!(current)
            : intent.kind === "undo"
              ? this.undoEntries.at(-1)
              : this.redoEntries.at(-1);
        if (!entry) {
          intent.resolve();
          continue;
        }
        const edit =
          intent.kind === "edit"
            ? reconcileAudioTransitionOperations(
                current,
                entry.redo,
                entry.undo,
              )
            : entry;
        const operations = intent.kind === "undo" ? edit.undo : edit.redo;
        if (intent.kind === "edit")
          intent.summary = [
            ...new Set(
              operations.map((operation) =>
                operation.type.includes("Track")
                  ? "轨道编辑"
                  : operation.type.includes("Clip")
                    ? "片段编辑"
                    : operation.type.includes("Transition")
                      ? "转场编辑"
                      : "工程设置编辑",
              ),
            ),
          ].join("、");
        if (!operations.length) {
          intent.resolve();
          continue;
        }
        const next = await this.io.write(current.revision, operations);
        if (!this.closed) {
          if (intent.kind === "edit") {
            if (edit.undo.length)
              this.undoEntries = [...this.undoEntries.slice(-99), edit];
            this.redoEntries = [];
          } else if (intent.kind === "undo") {
            this.undoEntries.pop();
            this.redoEntries.push(edit);
          } else {
            this.redoEntries.pop();
            this.undoEntries.push(edit);
          }
          this.io.saved(next);
        }
        intent.resolve();
      } catch (error) {
        this.retained = [intent, ...this.pending];
        this.pending = [];
        for (const item of this.retained) item.reject(error);
        if (!this.closed) this.io.failed(error);
        break;
      }
    }
    this.running = false;
    if (!this.closed) this.io.changed();
  }
}

/** Capture inverse values at submission time, rather than at the previous render. */
export function refreshUndo(
  timeline: VideoEditorTimeline,
  undo: VideoEditorOperation[],
) {
  const tracks = timeline.document.tracks ?? [];
  const clips = tracks.flatMap((track) => track.clips ?? []);
  const transitions = timeline.document.transitions ?? [];
  const patchBefore = (value: object, patch: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(patch).map((key) => [
        key,
        (value as Record<string, unknown>)[key] ?? null,
      ]),
    );
  return undo.map((operation): VideoEditorOperation => {
    if (operation.type === "updateSettings")
      return {
        ...operation,
        patch: patchBefore(timeline.document.settings ?? {}, operation.patch),
      };
    if (operation.type === "setAssetOrganization")
      return {
        ...operation,
        organization: structuredClone(
          timeline.document.assetOrganization ?? {},
        ),
      };
    if (operation.type === "restoreClipStates")
      return {
        ...operation,
        clips: operation.clips.map((clip) =>
          structuredClone(clips.find((item) => item.id === clip.id) ?? clip),
        ),
      };
    if (
      operation.type === "updateTrack" ||
      operation.type === "addTrack" ||
      operation.type === "reorderTrack"
    ) {
      const track = tracks.find(
        (item) =>
          item.id ===
          (operation.type === "addTrack"
            ? operation.track.id
            : operation.trackId),
      );
      if (track && operation.type === "updateTrack")
        return { ...operation, patch: patchBefore(track, operation.patch) };
      if (track && operation.type === "addTrack")
        return { ...operation, track: structuredClone(track) };
      if (track && operation.type === "reorderTrack")
        return { ...operation, order: track.order };
    }
    if (
      operation.type === "updateTransition" ||
      operation.type === "addTransition"
    ) {
      const transition = transitions.find(
        (item) =>
          item.id ===
          (operation.type === "addTransition"
            ? operation.transition.id
            : operation.transitionId),
      );
      if (transition && operation.type === "updateTransition")
        return {
          ...operation,
          patch: patchBefore(transition, operation.patch),
        };
      if (transition && operation.type === "addTransition")
        return { ...operation, transition: structuredClone(transition) };
    }
    const clip =
      "clipId" in operation
        ? clips.find((item) => item.id === operation.clipId)
        : operation.type === "addClip"
          ? clips.find((item) => item.id === operation.clip.id)
          : undefined;
    if (clip) {
      if (operation.type === "updateClip")
        return { ...operation, patch: patchBefore(clip, operation.patch) };
      if (operation.type === "addClip")
        return { ...operation, clip: structuredClone(clip) };
      if (operation.type === "moveClip")
        return {
          ...operation,
          trackId: clip.trackId,
          timelineStartUs: clip.timelineStartUs,
        };
      if (operation.type === "trimClip")
        return {
          ...operation,
          timelineStartUs: clip.timelineStartUs,
          sourceInUs: clip.sourceInUs,
          durationUs: clip.durationUs,
        };
      if (operation.type === "setClipSpeed")
        return { ...operation, playbackRate: clip.playbackRate ?? 1 };
      if (operation.type === "setTransition")
        return {
          ...operation,
          transition:
            (operation.edge === "in"
              ? clip.transitionIn
              : clip.transitionOut) ?? null,
        };
    }
    return structuredClone(operation);
  });
}
