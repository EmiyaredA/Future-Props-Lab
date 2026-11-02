import { useEffect, useState } from "react";
import type { TransferProgress } from "@platform/api/transfer";
import { formatFileSize } from "@shared/lib/fileSize";
import "./loading-state.css";

export function ProgressBar({
  value,
  max = 100,
  label = "加载进度",
  className = "",
}: {
  value?: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const percent =
    value != null && Number.isFinite(value) && max > 0
      ? Math.min(100, Math.max(0, (value / max) * 100))
      : undefined;
  return (
    <span
      className={`fpl-progress ${percent == null ? "is-indeterminate" : ""} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent == null ? undefined : Math.round(percent)}
    >
      <span style={percent == null ? undefined : { width: `${percent}%` }} />
    </span>
  );
}

export function LoadingState({
  label = "正在加载…",
  variant = "region",
  progress,
  delay = 150,
  className = "",
}: {
  label?: string;
  variant?: "page" | "region" | "inline";
  progress?: TransferProgress;
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(delay === 0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const reveal = window.setTimeout(() => setVisible(true), delay);
    const clock = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => {
      window.clearTimeout(reveal);
      window.clearInterval(clock);
    };
  }, [delay]);
  const percent =
    progress?.total && progress.phase === "transferring"
      ? (progress.loaded / progress.total) * 100
      : undefined;
  return (
    <span
      className={`fpl-loading fpl-loading--${variant} ${visible ? "is-visible" : ""} ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="fpl-loading-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="fpl-loading-copy">
        <span className="fpl-loading-label">
          {progress?.phase === "processing" ? "服务端处理中…" : label}
        </span>
        <span aria-hidden={variant === "inline" ? true : undefined}>
          <ProgressBar value={percent} label={label} />
        </span>
        {progress && progress.phase === "transferring" ? (
          <span className="fpl-loading-metrics" aria-live="off">
            {progress.direction === "upload" ? "已上传 " : "已加载 "}
            {formatFileSize(progress.loaded)}
            {progress.total != null
              ? ` / ${formatFileSize(progress.total)}`
              : ""}
            {percent != null ? ` · ${Math.min(100, percent).toFixed(0)}%` : ""}
            {progress.bytesPerSecond > 0
              ? ` · ${formatFileSize(progress.bytesPerSecond)}/s`
              : ""}
          </span>
        ) : null}
        {seconds >= 10 ? (
          <span className="fpl-loading-wait">
            已等待 {seconds} 秒，请检查网络或稍候。
          </span>
        ) : null}
      </span>
    </span>
  );
}
