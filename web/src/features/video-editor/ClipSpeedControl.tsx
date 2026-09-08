import { useEffect, useState } from "react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";

export function ClipSpeedControl({
  clip,
  clips,
  commit,
}: {
  clip: VideoEditorClip;
  clips: VideoEditorClip[];
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const currentRate = clip.playbackRate ?? 1;
  const [value, setValue] = useState(String(currentRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setValue(String(currentRate));
    setError("");
  }, [clip.id, currentRate]);
  const apply = async () => {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) {
      setError("请输入 0.25～4 之间的速度");
      return;
    }
    if (saving || rate === currentRate) return;
    const affected = [
      clip,
      ...clips.filter(
        (item) =>
          item.id !== clip.id &&
          clip.linkGroupId &&
          item.linkGroupId === clip.linkGroupId,
      ),
    ];
    const undo: VideoEditorOperation[] = [
      ...affected.map((item) => ({
        type: "removeClip" as const,
        clipId: item.id,
      })),
      ...affected.map((item) => ({ type: "addClip" as const, clip: item })),
    ];
    setSaving(true);
    setError("");
    try {
      await commit(
        [{ type: "setClipSpeed", clipId: clip.id, playbackRate: rate }],
        undo,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "变速保存失败，请重试",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="ve-inspector-section ve-speed-section">
      <div className="ve-section-heading">
        <div>
          <h3>播放速度</h3>
          <p>调整片段节奏，关联音频会同步变速</p>
        </div>
        <span>{currentRate}×</span>
      </div>
      <div className="ve-speed-control">
        <label className="ve-stacked-field">
          <span>
            速度倍率 <small>0.25–4×</small>
          </span>
          <input
            aria-label="播放速度倍率"
            type="number"
            min="0.25"
            max="4"
            step="0.05"
            value={value}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void apply();
              }
            }}
          />
        </label>
        <button
          className="ve-primary-action"
          type="button"
          disabled={saving || Number(value) === currentRate}
          onClick={() => void apply()}
        >
          {saving ? "保存中…" : "应用"}
        </button>
      </div>
      <p className="ve-field-help">
        保留素材范围并自动调整片段时长，同时保持音调。
      </p>
      {error ? (
        <p className="ve-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
