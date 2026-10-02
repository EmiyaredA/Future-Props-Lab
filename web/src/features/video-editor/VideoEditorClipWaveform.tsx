import type { VideoEditorAsset, VideoEditorClip } from "./types";

export function VideoEditorClipWaveform({
  asset,
  clip,
  url,
}: {
  asset?: VideoEditorAsset;
  clip: VideoEditorClip;
  url?: string;
}) {
  const sourceDurationUs = Number(asset?.probe?.durationUs);
  const sourceSpanUs = clip.durationUs * (clip.playbackRate ?? 1);
  if (!url || !(sourceDurationUs > 0) || !(sourceSpanUs > 0)) return null;
  return (
    <span className="ve-clip-waveform" aria-hidden="true">
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          width: `${(sourceDurationUs / sourceSpanUs) * 100}%`,
          left: `${(-clip.sourceInUs / sourceSpanUs) * 100}%`,
        }}
      />
    </span>
  );
}
