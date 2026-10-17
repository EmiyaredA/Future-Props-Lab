import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  executionDetails,
  samplingPercent,
} from "@shared/ui/taskExecutionPresentation";
import type { GenerationActivity as Activity } from "./generationActivityModel";
import "./generation-activity.css";

export function GenerationSpinner({ size = 16 }: { size?: number }) {
  return (
    <LoaderCircle
      size={size}
      className="visual-generation-spinner"
      aria-hidden
    />
  );
}

export function GenerationActivity({
  activity,
  showTaskLink = true,
}: {
  activity: Activity;
  showTaskLink?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity.id]);
  const start = Date.parse(activity.createdAt);
  const sampling = samplingPercent(activity.executionInfo, now);
  const progress = sampling ?? activity.progress;
  const details = executionDetails(activity.executionInfo, now);
  const elapsed = Number.isFinite(start)
    ? Math.max(0, Math.floor((now - start) / 1000))
    : undefined;
  const clock =
    elapsed === undefined
      ? undefined
      : `${Math.floor(elapsed / 60)
          .toString()
          .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  return (
    <div className="visual-generation-activity" aria-label="当前生成状态">
      <div className="visual-generation-activity-line">
        <GenerationSpinner />
        <strong role="status">{activity.label}</strong>
        {clock && (
          <time dateTime={`PT${elapsed}S`} aria-label={`已用时 ${clock}`}>
            已用时 {clock}
          </time>
        )}
        {progress !== undefined && (
          <span>
            {sampling !== undefined ? "采样 " : ""}
            {progress}%
          </span>
        )}
        {showTaskLink && (
          <a href="/apps/visual-workshop/tasks" aria-label="查看生成任务">
            查看任务
          </a>
        )}
      </div>
      {details && <p className="visual-generation-details">{details}</p>}
      <div
        className={`visual-generation-track${progress === undefined ? " is-indeterminate" : ""}`}
        role="progressbar"
        aria-label={sampling !== undefined ? "当前节点采样进度" : "生成进度"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <i
          style={progress === undefined ? undefined : { width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
