import { LayoutGrid, Workflow } from "lucide-react";
import type { WorkbenchView } from "./ProjectCreativeTools";

export function WorkbenchViewToggle({
  view,
  onView,
  disabled = false,
}: {
  view: WorkbenchView;
  onView: (view: WorkbenchView) => void;
  disabled?: boolean;
}) {
  return (
    <div className="workbench-view-toggle" role="group" aria-label="工作台视图">
      {(
        [
          ["canvas", "画布", Workflow],
          ["board", "看板", LayoutGrid],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={view === value}
          disabled={disabled}
          onClick={() => view !== value && onView(value)}
        >
          <Icon size={16} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
