import { useEffect, useRef, useState } from "react";
import type { PetDocument } from "./api";
import {
  reactionFor,
  playbackDuration,
  type PetEvent,
  type PetPlaybackMode,
} from "./playback";
import { playPetTone } from "./sound";
import type { MotionDemo } from "./locomotion/demo";

export type EditorTab =
  "look" | "events" | "lines" | "chat" | "habits" | "preview";
export function useEditorPreview(
  document: PetDocument | null,
  tab: EditorTab,
  selected: PetEvent,
) {
  const target = tab === "events" || tab === "lines" ? selected : "idle";
  const signature = JSON.stringify([
    tab,
    target,
    document && reactionFor(document, target),
  ]);
  const serial = useRef(0);
  const editingLine = useRef(0);
  const previousTarget = useRef(target);
  const lines = useRef<Partial<Record<PetEvent, number>>>({});
  const [playback, setPlayback] = useState({
    eventName: target,
    mode: "inspect" as PetPlaybackMode,
    key: 0,
    line: 0,
    demo: null as MotionDemo | null,
  });
  useEffect(() => {
    if (previousTarget.current !== target) editingLine.current = 0;
    previousTarget.current = target;
    setPlayback({
      eventName: target,
      mode: "inspect",
      key: ++serial.current,
      demo: null,
      line: Math.min(
        editingLine.current,
        Math.max(
          0,
          ((document && reactionFor(document, target).lines?.length) || 0) - 1,
        ),
      ),
    });
    // The signature contains precisely the editor inputs that restart a preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    if (!document || playback.mode !== "event" || playback.eventName === "idle")
      return;
    const timer = window.setTimeout(
      () =>
        setPlayback((current) => ({
          ...current,
          eventName: "idle",
          mode: "runtime",
        })),
      playbackDuration(document, playback.eventName),
    );
    return () => window.clearTimeout(timer);
    // A new key owns the timer; unrelated draft fields do not restart an event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.key, playback.mode]);
  const inspect = (eventName: PetEvent) =>
    setPlayback({
      eventName,
      mode: "inspect",
      key: ++serial.current,
      line: 0,
      demo: null,
    });
  const play = (eventName: PetEvent) => {
    if (!document) return;
    const reaction = reactionFor(document, eventName);
    const count = reaction.lines?.length ?? 0;
    const line = count ? ((lines.current[eventName] ?? -1) + 1) % count : 0;
    lines.current[eventName] = line;
    if (document.config.habits?.sound) playPetTone(reaction.sound);
    setPlayback({
      eventName,
      mode: "event",
      key: ++serial.current,
      line,
      demo: null,
    });
  };
  const bubble =
    document && playback.mode !== "runtime" && document.config.habits?.bubbles
      ? (reactionFor(document, playback.eventName).lines?.[playback.line] ?? "")
      : "";
  return {
    ...playback,
    bubble,
    inspect,
    play,
    playSelected: () => play(target),
    motionDemo:
      playback.demo ??
      (document?.sourceType === "coopanion-whale" &&
      playback.eventName === "grab" &&
      playback.mode !== "runtime"
        ? "held"
        : null),
    demonstrate: (demo: MotionDemo) =>
      setPlayback({
        eventName: "idle",
        mode: "inspect",
        key: ++serial.current,
        line: 0,
        demo,
      }),
    selectLine: (line: number) => {
      editingLine.current = line;
    },
  };
}
