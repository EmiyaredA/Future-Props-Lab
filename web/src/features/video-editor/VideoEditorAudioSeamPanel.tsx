import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { useEffect, useState } from "react";
import { formatTime, frameUs } from "./editorModel";
import { useAudioSeamPreview } from "./useAudioSeamPreview";
import type {
  AudioSeamCandidates,
  VideoEditorAsset,
  VideoEditorClip,
} from "./types";
import "./video-editor-audio-seam.css";

function Wave({
  peaks,
  label,
  maximum,
}: {
  peaks: number[];
  label: string;
  maximum: number;
}) {
  return (
    <div className="ve-audio-seam-wave" role="img" aria-label={label}>
      {peaks.map((peak, index) => (
        <i
          key={index}
          style={{ height: `${Math.max(4, (peak / maximum) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function VideoEditorAudioSeamPanel({
  from,
  to,
  asset,
  data,
  loading,
  error,
  selected,
  onSelect,
  onApply,
  onClose,
  fps,
}: {
  from: VideoEditorClip;
  to: VideoEditorClip;
  asset?: VideoEditorAsset;
  data?: AudioSeamCandidates;
  loading: boolean;
  error?: string;
  selected: number;
  onSelect: (index: number) => void;
  onApply: (sourceInUs: number, fadeUs: number) => Promise<void>;
  onClose: () => void;
  fps: number;
}) {
  const candidate = data?.candidates[selected];
  const waveMaximum = Math.max(
    0.01,
    ...(data?.referencePeaks ?? []),
    ...(candidate?.peaks ?? []),
  );
  const { url: proxyUrl, loading: proxyLoading } = useApiBlobUrl(
    asset?.proxyUrl,
  );
  const preview = useAudioSeamPreview();
  const [fadeUs, setFadeUs] = useState(300_000);
  const [actionError, setActionError] = useState("");
  const [applying, setApplying] = useState(false);
  const maxFadeUs = Math.max(
    50_000,
    Math.min(
      1_000_000,
      from.durationUs - frameUs(fps),
      to.durationUs - frameUs(fps),
    ),
  );
  useEffect(() => {
    setFadeUs(Math.min(maxFadeUs, candidate?.suggestedFadeUs ?? 300_000));
    setActionError("");
    preview.stop();
    // Selection changes invalidate the previous audition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.sourceInUs, candidate?.suggestedFadeUs, maxFadeUs]);
  return (
    <section className="ve-audio-seam-panel" aria-label="相似音频接点">
      <header>
        <strong>相似音频接点</strong>
        <button type="button" onClick={onClose} aria-label="关闭接点辅助">
          ×
        </button>
      </header>
      <p>
        {from.name} → {to.name}
      </p>
      {loading ? <p role="status">正在分析整段可用音乐…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {data && !data.candidates.length ? (
        <p role="status">
          没有找到可靠的候选点；可继续手动修剪和添加音频淡化。
        </p>
      ) : null}
      {data?.candidates.length ? (
        <>
          <div className="ve-audio-seam-reference">
            <span>A 尾部 · {formatTime(data.referenceStartUs)}</span>
            <Wave
              peaks={data.referencePeaks}
              label="前一片段末尾两秒的放大波形"
              maximum={waveMaximum}
            />
          </div>
          <div
            className="ve-audio-seam-candidates"
            role="group"
            aria-label="候选切点"
          >
            {data.candidates.map((item, index) => (
              <button
                type="button"
                key={item.sourceInUs}
                className={selected === index ? "selected" : ""}
                aria-pressed={selected === index}
                onClick={() => onSelect(index)}
              >
                <span>
                  候选 {index + 1} · {formatTime(item.sourceInUs)}
                </span>
                <small>{item.matchReasons.join("、")}</small>
              </button>
            ))}
          </div>
          {candidate ? (
            <>
              <div className="ve-audio-seam-reference">
                <span>B 候选开头 · {formatTime(candidate.sourceInUs)}</span>
                <Wave
                  peaks={candidate.peaks}
                  label="后一片段候选开头两秒的放大波形"
                  maximum={waveMaximum}
                />
              </div>
              <label className="ve-audio-seam-fade">
                <span>交叉淡化 · {(fadeUs / 1_000_000).toFixed(2)} 秒</span>
                <input
                  type="range"
                  min={50_000}
                  max={maxFadeUs}
                  step={10_000}
                  value={fadeUs}
                  onChange={(event) => setFadeUs(Number(event.target.value))}
                  aria-label="接点交叉淡化时长"
                />
              </label>
              {actionError ? <p role="alert">{actionError}</p> : null}
              <div className="ve-audio-seam-actions">
                <button
                  type="button"
                  disabled={!proxyUrl || proxyLoading}
                  onClick={() => {
                    if (preview.playing) {
                      preview.stop();
                      return;
                    }
                    void preview
                      .play(proxyUrl, from, to, candidate.sourceInUs, fadeUs)
                      .catch((caught: unknown) =>
                        setActionError(
                          caught instanceof Error ? caught.message : "预听失败",
                        ),
                      );
                  }}
                >
                  {preview.playing
                    ? "停止预听"
                    : proxyLoading
                      ? "加载预听…"
                      : "预听接缝"}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={applying}
                  onClick={() => {
                    setApplying(true);
                    void onApply(candidate.sourceInUs, fadeUs)
                      .catch((caught: unknown) =>
                        setActionError(
                          caught instanceof Error ? caught.message : "应用失败",
                        ),
                      )
                      .finally(() => setApplying(false));
                  }}
                >
                  {applying ? "应用中…" : "应用修剪与淡化"}
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
