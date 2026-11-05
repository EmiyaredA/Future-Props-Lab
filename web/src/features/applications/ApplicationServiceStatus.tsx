import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  servicePhaseLabels,
  serviceStatusTime,
  type ServiceStatus,
} from "./serviceStatus";
import "./service-status.css";

export function ApplicationServiceStatus({
  name,
  value,
  checking = false,
  unavailable = false,
}: {
  name: string;
  value?: ServiceStatus;
  checking?: boolean;
  unavailable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const phase = unavailable ? "unknown" : (value?.phase ?? "unknown");
  const label =
    checking && !value && !unavailable ? "检查中…" : servicePhaseLabels[phase];
  const detail = unavailable
    ? "无法读取最新服务状态，正在等待连接恢复。"
    : (value?.detail ?? "尚未取得服务状态，请稍后刷新。");
  return (
    <div className="application-service-status" data-phase={phase}>
      <button
        type="button"
        className="application-status-toggle"
        aria-label={`查看${name}服务状态：${label}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="application-status-dot" aria-hidden />
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {phase !== "running" &&
        (!checking || !!value || unavailable) &&
        !expanded && <p className="application-status-summary">{detail}</p>}
      {expanded && (
        <div
          id={id}
          role="region"
          aria-label={`${name}服务状态`}
          className="application-status-detail"
        >
          <p>{detail}</p>
          {!!value?.dependencies?.length && (
            <ul>
              {value?.dependencies?.map((dependency) => (
                <li key={dependency.service_id}>
                  {dependency.label}：{servicePhaseLabels[dependency.phase]}
                </li>
              ))}
            </ul>
          )}
          <small>最近检查：{serviceStatusTime(value?.checked_at)}</small>
          {unavailable && value && (
            <small>上次结果：{servicePhaseLabels[value.phase]}</small>
          )}
        </div>
      )}
    </div>
  );
}
