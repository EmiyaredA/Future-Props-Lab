import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "@shared/ui/custom-select.css";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`select-chevron${open ? " open" : ""}`}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <path d="m3 5 4 4 4-4" />
    </svg>
  );
}

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
  leadingIcon,
  showChevron = true,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  leadingIcon?: ReactNode;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className={`custom-select ${className}`} ref={root}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span className="custom-select-trigger-content">
          {leadingIcon}
          <span>{selected?.label ?? "请选择"}</span>
        </span>
        {showChevron ? <Chevron open={open} /> : null}
      </button>
      {open ? (
        <div className="custom-select-menu" id={listId} role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
