import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { LogFilters as Filters } from "@features/models/api";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { logProviderKindOptions } from "./logOptions";
import { sourceLabels } from "./modelCallLogPresentation";

type ControlsProps = {
  filters: Filters;
  models: string[];
  onChange: (filters: Filters) => void;
};
function QuickFilters({ filters, models, onChange }: ControlsProps) {
  const fields = [
    {
      key: "callSource" as const,
      label: "调用源",
      options: Object.entries(sourceLabels).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      key: "providerKind" as const,
      label: "供应商",
      options: logProviderKindOptions.filter((x) => x.value),
    },
    {
      key: "model" as const,
      label: "模型",
      options: models.map((value) => ({ value, label: value })),
    },
    {
      key: "status" as const,
      label: "状态",
      options: [
        { value: "success", label: "成功" },
        { value: "error", label: "失败" },
      ],
    },
  ];
  return (
    <>
      {fields.map((field) => (
        <CustomSelect
          key={field.key}
          ariaLabel={`${field.label}筛选`}
          value={filters[field.key]}
          options={[
            { value: "", label: `全部${field.label}` },
            ...field.options,
          ]}
          onChange={(value) =>
            onChange({ ...filters, [field.key]: value, page: 1 })
          }
        />
      ))}
    </>
  );
}
export function LogToolbar({
  filters,
  models,
  onChange,
  scope,
  options,
  onScopeChange,
  showScope,
  onOpen,
  resetVersion,
}: ControlsProps & {
  resetVersion: number;
  scope: string;
  options: { value: string; label: string }[];
  onScopeChange: (value: string) => void;
  showScope: boolean;
  onOpen: () => void;
}) {
  const [search, setSearch] = useState(filters.q);
  // Reset the draft when an explicit reset changes the applied keyword.
  const [applied, setApplied] = useState(filters.q);
  const [previousReset, setPreviousReset] = useState(resetVersion);
  if (applied !== filters.q || previousReset !== resetVersion) {
    setPreviousReset(resetVersion);
    setApplied(filters.q);
    setSearch(filters.q);
  }
  const count = Number(!!filters.from) + Number(!!filters.to);
  return (
    <div className="call-log-toolbar">
      <form
        className="call-log-search"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ ...filters, q: search.trim(), page: 1 });
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="搜索调用日志"
          placeholder="搜索模型 / 日志 ID / Trace ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>
      {showScope && (
        <div className="call-log-scope">
          <CustomSelect
            ariaLabel="日志工作区"
            value={scope}
            options={options}
            onChange={onScopeChange}
          />
        </div>
      )}
      <div className="call-log-quick">
        <QuickFilters filters={filters} models={models} onChange={onChange} />
      </div>
      <button className="btn call-log-filter-trigger" onClick={onOpen}>
        <SlidersHorizontal size={16} />
        筛选{count > 0 && <span>{count}</span>}
      </button>
    </div>
  );
}
export function LogFilterDrawer({
  filters,
  models,
  onChange,
  onClose,
  onReset,
}: ControlsProps & { onClose: () => void; onReset: () => void }) {
  const [draft, setDraft] = useState(filters);
  const ref = useDrawerFocus<HTMLElement>(onClose, true, false);
  const invalid = !!draft.from && !!draft.to && draft.from > draft.to;
  return (
    <div
      className="call-log-filter-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside ref={ref} className="call-log-filter-drawer" aria-label="日志筛选">
        <header>
          <div>
            <h2>筛选</h2>
            <p>按调用时间进一步缩小日志范围</p>
          </div>
          <button
            className="btn icon-btn"
            aria-label="关闭筛选"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="call-log-filter-body">
          <div className="call-log-drawer-quick">
            <QuickFilters filters={draft} models={models} onChange={setDraft} />
          </div>
          <fieldset>
            <legend>日期范围</legend>
            <label>
              开始日期
              <CustomDateInput
                ariaLabel="开始日期"
                value={draft.from}
                onChange={(from) => setDraft({ ...draft, from })}
              />
            </label>
            <label>
              结束日期
              <CustomDateInput
                ariaLabel="结束日期"
                value={draft.to}
                onChange={(to) => setDraft({ ...draft, to })}
              />
            </label>
          </fieldset>
          {invalid && (
            <p role="alert" className="danger-text">
              开始日期不能晚于结束日期
            </p>
          )}
        </div>
        <footer>
          <button className="btn" onClick={onReset}>
            重置
          </button>
          <button
            className="btn primary"
            disabled={invalid}
            onClick={() => {
              onChange({ ...draft, page: 1 });
              onClose();
            }}
          >
            应用筛选
          </button>
        </footer>
      </aside>
    </div>
  );
}
