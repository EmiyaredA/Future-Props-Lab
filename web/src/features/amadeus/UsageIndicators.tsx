import * as Dialog from "@radix-ui/react-dialog";
import { Activity, CircleGauge, X } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { ActionHint } from "./ActionIcon";
import { conversationUsage, tokenCount } from "./conversationUsage";
import type { Run, RunDetail } from "./protocol";

const format = (value: number | null | undefined) =>
  value == null ? "未记录" : tokenCount.format(value);

function UsagePopover({
  label,
  summary,
  icon,
  children,
}: {
  label: string;
  summary: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const attachPanel = useCallback((element: HTMLDivElement | null) => {
    panel.current = element;
    setMounted(element !== null);
  }, []);
  useSelectPopover(open && mounted, trigger, panel, 340, 340, "end", "top");
  return (
    <Dialog.Root modal={false} open={open} onOpenChange={setOpen}>
      <ActionHint label={summary}>
        <Dialog.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={label}
            className="amadeus-action-icon amadeus-usage-trigger"
          >
            {icon}
          </button>
        </Dialog.Trigger>
      </ActionHint>
      <Dialog.Content
        ref={attachPanel}
        popover="manual"
        aria-describedby={undefined}
        className="amadeus-usage-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        <header>
          <Dialog.Title>{label}</Dialog.Title>
          <Dialog.Close
            type="button"
            aria-label="关闭"
            className="amadeus-action-icon"
          >
            <X size={15} aria-hidden />
          </Dialog.Close>
        </header>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function UsageIndicators({
  conversationId,
  runs,
  active,
}: {
  conversationId?: string;
  runs: RunDetail[];
  active: Run | null;
}) {
  const usage = conversationUsage(conversationId, runs, active);
  const { current } = usage;
  const used = current?.usage?.context_used;
  const limit = current?.usage?.context_limit;
  const percent =
    used != null && limit != null && limit > 0
      ? Math.round((used / limit) * 100)
      : null;
  const context =
    used != null && limit != null
      ? `${format(used)} / ${format(limit)} Token`
      : used != null
        ? `已用 ${format(used)} Token`
        : limit != null
          ? `上限 ${format(limit)} Token`
          : "未记录";
  const turnLabel = usage.active ? "当前轮" : "最近一轮";
  const model = current?.agent_model || current?.agent_id || current?.model_id;
  return (
    <div className="amadeus-usage-indicators">
      <UsagePopover
        label="上下文窗口"
        summary={`上下文窗口 · ${turnLabel} · ${context}`}
        icon={
          percent == null ? (
            <CircleGauge size={17} aria-hidden />
          ) : (
            <span className="amadeus-context-ring" aria-hidden>
              <svg viewBox="0 0 34 34">
                <circle cx="17" cy="17" r="14" />
                <circle
                  cx="17"
                  cy="17"
                  r="14"
                  pathLength="100"
                  strokeDasharray={`${Math.min(percent, 100)} 100`}
                />
              </svg>
              <span>{percent}%</span>
            </span>
          )
        }
      >
        {current && (
          <p>
            {turnLabel}
            {model && ` · ${model}`}
          </p>
        )}
        <p>
          <strong>{context}</strong>
          {percent != null && ` · ${percent}%`}
        </p>
      </UsagePopover>
      <UsagePopover
        label="对话用量"
        summary={`对话用量 · ${usage.reportedRuns} / ${usage.runCount} 轮有记录`}
        icon={<Activity size={17} aria-hidden />}
      >
        <p>
          {usage.reportedRuns} / {usage.runCount} 轮有 Token 记录
        </p>
        <table aria-label="Token 用量">
          <thead>
            <tr>
              <th>Token</th>
              <th>{turnLabel}</th>
              <th>本对话</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map(({ key, label, recorded, total }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{format(current?.usage?.[key])}</td>
                <td>
                  {format(total)}
                  {recorded > 0 && recorded < usage.runCount && (
                    <small>（{recorded} 轮）</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </UsagePopover>
    </div>
  );
}
