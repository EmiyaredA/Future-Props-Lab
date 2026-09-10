import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { clipTrimPreview, type TrimEdge } from "./clipTrim";
import { frameUs } from "./editorModel";
import type { VideoEditorClip, VideoEditorOperation } from "./types";

type Options = Omit<
  Parameters<typeof clipTrimPreview>[0],
  "clip" | "edge" | "candidateUs"
> & {
  rawPositionUs: (clientX: number) => number;
  selectClip: (id?: string) => void;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onNotice?: (message: string) => void;
};
export function useTimelineClipTrim(options: Options) {
  const [preview, setPreview] = useState<ReturnType<typeof clipTrimPreview>>();
  const cleanupRef = useRef<() => void>(undefined);
  const saving = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);
  const save = (next: ReturnType<typeof clipTrimPreview>) => {
    if (next.error) {
      options.onNotice?.(next.error);
      setPreview(undefined);
      return;
    }
    const changed = next.states?.some(
      (item, i) => item.durationUs !== next.originals[i].durationUs,
    );
    if (!changed) {
      setPreview(undefined);
      return;
    }
    saving.current = true;
    setPreview({ ...next, guideUs: undefined });
    void options
      .commit(
        next.states!.map((item) => ({
          type: "trimClip",
          clipId: item.id,
          timelineStartUs: item.timelineStartUs,
          durationUs: item.durationUs,
          sourceInUs: item.sourceInUs,
        })),
        [{ type: "restoreClipStates", clips: next.originals }],
      )
      .catch(() => undefined)
      .finally(() => {
        saving.current = false;
        setPreview(undefined);
      });
  };
  const startTrim = (
    event: ReactPointerEvent<HTMLButtonElement>,
    clip: VideoEditorClip,
    edge: TrimEdge,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || saving.current) return;
    cleanupRef.current?.();
    options.selectClip(clip.id);
    event.currentTarget.focus();
    const origin = event.clientX;
    const pointerId = event.pointerId;
    const boundary =
      clip.timelineStartUs + (edge === "end" ? clip.durationUs : 0);
    const grabUs = options.rawPositionUs(origin);
    let next: ReturnType<typeof clipTrimPreview> | undefined;
    let moved = false;
    const update = (pointer: PointerEvent) => {
      if (!moved && Math.abs(pointer.clientX - origin) < 3) return;
      moved = true;
      next = clipTrimPreview({
        ...options,
        clip,
        edge,
        candidateUs: boundary + options.rawPositionUs(pointer.clientX) - grabUs,
      });
      setPreview(next);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      pointer.preventDefault();
      update(pointer);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keydown);
      cleanupRef.current = undefined;
    };
    const cancel = () => {
      cleanup();
      setPreview(undefined);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      update(pointer);
      cleanup();
      if (next) save(next);
      else setPreview(undefined);
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", keydown);
  };
  const keyTrim = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    clip: VideoEditorClip,
    edge: TrimEdge,
  ) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.stopPropagation();
    event.preventDefault();
    if (saving.current) return;
    const boundary =
      clip.timelineStartUs + (edge === "end" ? clip.durationUs : 0);
    save(
      clipTrimPreview({
        ...options,
        clip,
        edge,
        snapEnabled: false,
        candidateUs:
          boundary +
          (event.key === "ArrowRight" ? 1 : -1) *
            frameUs(options.fps) *
            (event.shiftKey ? 10 : 1),
      }),
    );
  };
  return {
    trimStates: preview?.states,
    trimGuideUs: preview?.guideUs,
    startTrim,
    keyTrim,
  };
}
