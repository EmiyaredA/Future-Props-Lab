import { useEffect, useId, useRef, useState } from "react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
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
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const id = useId();
  useSelectPopover(open, trigger, popover, 220, 224);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", dismiss);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  const phase = unavailable ? "unknown" : (value?.phase ?? "unknown");
  const label =
    checking && !value && !unavailable ? "检查中…" : servicePhaseLabels[phase];
  const detail = unavailable
    ? "无法读取最新服务状态，正在等待连接恢复。"
    : (value?.detail ?? "尚未取得服务状态，请稍后刷新。");
  return (
    <div
      ref={wrapper}
      className="application-service-status"
      data-phase={phase}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" || !open) return;
        closeTimer.current = setTimeout(() => setOpen(false), 150);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="application-status-toggle"
        aria-label={`查看${name}服务状态：${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          if (
            event.detail &&
            "pointerType" in event.nativeEvent &&
            event.nativeEvent.pointerType === "mouse"
          )
            return;
          setOpen((current) => !current);
        }}
      >
        <span className="application-status-dot" aria-hidden />
        <span>{label}</span>
      </button>
      {open && (
        <div
          ref={popover}
          id={id}
          role="region"
          aria-label={`${name}服务状态`}
          className="application-status-detail"
          popover="manual"
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
