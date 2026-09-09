import { useEffect, useState } from "react";
import { linkedClipIds } from "./timelineSnap";
import type { VideoEditorClip, VideoEditorOperation } from "./types";

export function ClipSpeedControl({
  clip,
  clips,
  ripple = true,
  onRippleChange,
  commit,
}: {
  clip: VideoEditorClip;
  clips: VideoEditorClip[];
  ripple?: boolean;
  onRippleChange?: (value: boolean) => void;
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
    const allClips = clips.some((item) => item.id === clip.id)
      ? clips
      : [...clips, clip];
    const speedIds = linkedClipIds(allClips, [clip.id]);
    const followingIds = ripple
      ? linkedClipIds(
          allClips,
          allClips
            .filter(
              (item) =>
                item.trackId === clip.trackId &&
                !speedIds.has(item.id) &&
                item.timelineStartUs >= clip.timelineStartUs + clip.durationUs,
            )
            .map((item) => item.id),
        )
      : new Set<string>();
    const undo: VideoEditorOperation[] = [
      {
        type: "restoreClipStates",
        clips: allClips.filter(
          (item) => speedIds.has(item.id) || followingIds.has(item.id),
        ),
      },
    ];
    setSaving(true);
    setError("");
    try {
      await commit(
        [{ type: "setClipSpeed", clipId: clip.id, playbackRate: rate, ripple }],
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
      <button
        type="button"
        role="switch"
        aria-checked={ripple}
        className="ve-speed-ripple"
        disabled={saving}
        onClick={() => onRippleChange?.(!ripple)}
      >
        <span>后续片段跟随</span>
        <span className="ve-switch-indicator" aria-hidden />
      </button>
      <p className="ve-field-help">
        {ripple
          ? "同轨后续片段及其关联音频随时长变化移动，保留原有间隔。"
          : "仅调整当前片段及关联媒体，后续片段保持原位。"}
      </p>
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
