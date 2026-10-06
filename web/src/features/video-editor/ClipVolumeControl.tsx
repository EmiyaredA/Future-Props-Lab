import { Diamond } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import { volumeInputError } from "./volumeInput";

export function ClipVolumeControl({
  clip,
  playheadUs,
  commit,
}: {
  clip: VideoEditorClip;
  playheadUs: number;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const [value, setValue] = useState(String(clip.volume));
  const [error, setError] = useState("");
  const descriptionId = useId();
  const keyframeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setValue(String(clip.volume));
    setError("");
  }, [clip.id, clip.volume]);

  const apply = async (withKeyframe = false) => {
    const volume = Number(value);
    const validationError = volumeInputError(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    const redo: VideoEditorOperation[] = [];
    const undo: VideoEditorOperation[] = [];
    if (volume !== clip.volume) {
      redo.push({ type: "updateClip", clipId: clip.id, patch: { volume } });
      undo.push({
        type: "updateClip",
        clipId: clip.id,
        patch: { volume: clip.volume },
      });
    }
    if (withKeyframe) {
      const keyframe = {
        id: crypto.randomUUID(),
        property: "volume" as const,
        timeUs: Math.min(
          Math.max(0, playheadUs - clip.timelineStartUs),
          clip.durationUs,
        ),
        value: volume,
        interpolation: "linear" as const,
      };
      redo.push({ type: "addKeyframe", clipId: clip.id, keyframe });
      undo.unshift({
        type: "removeKeyframe",
        clipId: clip.id,
        keyframeId: keyframe.id,
      });
    }
    if (!redo.length) return;
    try {
      await commit(redo, undo);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "音量保存失败，输入已保留",
      );
    }
  };

  return (
    <section className="ve-inspector-section">
      <div className="ve-section-heading">
        <div>
          <h3>音频</h3>
          <p>控制片段音量与关键帧</p>
        </div>
      </div>
      <label className="ve-key-field ve-audio-volume-field">
        <span>音量（倍）</span>
        <input
          aria-label="音量"
          aria-describedby={descriptionId}
          aria-invalid={Boolean(error)}
          type="number"
          min="0"
          max="4"
          step="0.05"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(volumeInputError(event.target.value));
          }}
          onBlur={(event) => {
            if (event.relatedTarget !== keyframeButton.current) void apply();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setValue(String(clip.volume));
              setError("");
            }
          }}
        />
        <button
          ref={keyframeButton}
          type="button"
          aria-label="为音量添加关键帧"
          onClick={() => void apply(true)}
        >
          <Diamond aria-hidden />
        </button>
      </label>
      <p
        id={descriptionId}
        className={error ? "ve-field-error" : "ve-field-help"}
        role={error ? "alert" : undefined}
      >
        {error || "范围 0～4 倍；1 为原始音量，0.1 为 10%，0 为静音。"}
      </p>
    </section>
  );
}
