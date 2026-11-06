import { Children, type ReactNode } from "react";
import {
  BookOpen,
  CircleHelp,
  Clock3,
  Globe2,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { components } from "@generated/api";
import { TranscriptDisclosure } from "./TranscriptMessage";

export type ActivityDetails = components["schemas"]["ActivityDetails"];

const activityIcons = {
  command: Terminal,
  search: Search,
  web: Globe2,
  file: BookOpen,
  question: CircleHelp,
  duration: Clock3,
};

const activityStatus: Record<string, string> = {
  failed: "失败",
  pending: "等待中",
  running: "运行中",
  unknown: "结果未知",
};

function activityDuration(value?: number | null) {
  if (!value) return null;
  const seconds = Math.floor(value / 1000);
  return seconds < 1
    ? `${value} 毫秒`
    : seconds < 60
      ? `${seconds} 秒`
      : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function ActivityDuration({
  milliseconds,
}: {
  milliseconds?: number | null;
}) {
  const value = activityDuration(milliseconds);
  return (
    value && (
      <span className="aw-activity-duration">
        <Clock3 size={13} aria-hidden="true" />
        用时 {value}
      </span>
    )
  );
}

export function ActivityRow({
  name,
  details,
  status,
  open,
  onToggle,
  onOpenFile,
  children,
}: {
  name: string;
  details?: ActivityDetails | null;
  status?: string | null;
  open?: boolean;
  onToggle?: (value: boolean) => void;
  onOpenFile?: () => void;
  children?: ReactNode;
}) {
  const Icon = details ? activityIcons[details.kind] : Wrench;
  const prefix =
    details?.kind === "web"
      ? "网页搜索"
      : details?.kind === "search"
        ? "搜索"
        : details?.kind === "question"
          ? "询问用户"
          : name;
  const title = [
    prefix,
    details?.label,
    onOpenFile ? null : details?.file?.path,
  ]
    .filter(Boolean)
    .join(" · ");
  const duration = activityDuration(details?.duration_ms);
  const state = status ? activityStatus[status] : undefined;
  const label = [title, state, duration].filter(Boolean).join(" · ");
  const questions = details?.questions ?? [];
  const answers = details?.answers ?? [];
  const expandedBody =
    Children.toArray(children).length > 0 ||
    questions.length > 0 ||
    answers.length > 0;
  return (
    <div className="aw-activity-row">
      <div className="aw-activity-main">
        {expandedBody ? (
          <TranscriptDisclosure title={label} open={open} onToggle={onToggle}>
            {questions.length > 0 && (
              <div className="aw-question">
                <small>提问</small>
                <ul>
                  {questions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
            {answers.length > 0 && (
              <div className="aw-question">
                <small>回答</small>
                <ul>
                  {answers.map((answer, index) => (
                    <li key={index}>{answer}</li>
                  ))}
                </ul>
              </div>
            )}
            {children}
          </TranscriptDisclosure>
        ) : (
          <span className="aw-activity-label">
            <Icon size={14} aria-hidden="true" />
            {label}
          </span>
        )}
      </div>
      {onOpenFile && details?.file && (
        <button
          type="button"
          className="aw-link aw-activity-file"
          data-file-path={details.file.path}
          data-file-line={details.file.line ?? undefined}
          onClick={onOpenFile}
        >
          {details.file.path}
        </button>
      )}
    </div>
  );
}
