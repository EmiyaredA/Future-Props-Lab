import { useRef, useState } from "react";
import { Diamond } from "lucide-react";
import {
  transformAt,
  transformLocalUs,
  transformEdit,
  boundedTransformValue,
  type TransformDraft,
  type TransformProperty,
} from "./transformModel";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
} from "./types";
import type { TimelineEditBuilder } from "./timelineSaveQueue";

function TransformInput({
  value,
  label,
  property,
  onCommit,
}: {
  value: number;
  label: string;
  property: TransformProperty;
  onCommit: (value: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const focusedValue = useRef(value);
  const cancelled = useRef(false);
  return (
    <>
      <input
        aria-label={label}
        type="number"
        step={
          property.startsWith("scale") ||
          property === "opacity" ||
          property === "brightness"
            ? 0.01
            : 1
        }
        value={editing ?? Number(value.toFixed(6))}
        onFocus={() => {
          focusedValue.current = value;
        }}
        onChange={(event) => setEditing(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            setEditing(undefined);
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          const raw = event.currentTarget.value;
          setEditing(undefined);
          if (raw === undefined || !raw.trim()) return;
          try {
            const next = boundedTransformValue(property, Number(raw));
            setError("");
            if (next !== focusedValue.current)
              void onCommit(next).catch((caught: unknown) =>
                setError(
                  caught instanceof Error ? caught.message : "变换保存失败",
                ),
              );
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "数值无效");
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}
export function VideoEditorTransformFields({
  clip,
  timeline,
  playheadUs,
  revision,
  draft,
  commit,
}: {
  clip: VideoEditorClip;
  timeline?: VideoEditorTimeline;
  playheadUs: number;
  revision?: number;
  draft?: TransformDraft;
  commit: (
    redo: VideoEditorOperation[] | TimelineEditBuilder,
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const current = {
    ...transformAt(clip, transformLocalUs(clip, playheadUs, timeline)),
    ...(draft?.clipId === clip.id &&
    draft.playheadUs === playheadUs &&
    draft.revision === revision
      ? draft.values
      : {}),
  };
  return (
    <section className="ve-inspector-section">
      <div className="ve-section-heading">
        <div>
          <h3>变换</h3>
          <p>调整位置、比例与画面表现</p>
        </div>
      </div>
      <div className="ve-property-grid">
        {(
          [
            ["x", "位置 X"],
            ["y", "位置 Y"],
            ["scaleX", "水平缩放"],
            ["scaleY", "垂直缩放"],
            ["rotation", "旋转"],
            ["opacity", "不透明度"],
            ["brightness", "亮度"],
          ] as const
        ).map(([property, label]) => (
          <label className="ve-property-field" key={property}>
            <span>{label}</span>
            <div className="ve-input-with-action">
              <TransformInput
                value={current[property]}
                label={label}
                property={property}
                onCommit={(value) =>
                  commit(
                    transformEdit(clip.id, playheadUs, { [property]: value }),
                  )
                }
              />
              <button
                type="button"
                aria-label={`为${label}添加关键帧`}
                title={`为${label}添加关键帧`}
                onClick={() => {
                  setError("");
                  void commit(
                    transformEdit(
                      clip.id,
                      playheadUs,
                      { [property]: current[property] },
                      { forceKeyframe: true },
                    ),
                  ).catch((caught: unknown) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "关键帧保存失败",
                    ),
                  );
                }}
              >
                <Diamond aria-hidden />
              </button>
            </div>
          </label>
        ))}
      </div>
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
