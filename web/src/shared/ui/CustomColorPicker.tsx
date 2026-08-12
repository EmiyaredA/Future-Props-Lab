import { useEffect, useRef, useState } from "react";
import "@shared/ui/custom-color-picker.css";

const DEFAULT_COLORS = [
  "#000000",
  "#FFFFFF",
  "#172133",
  "#E75B55",
  "#E59B3D",
  "#46B978",
  "#4AA3DF",
  "#7586E5",
  "#A56DE2",
  "#D85E9D",
  "#32A6A0",
];

function normalizeColor(value: string) {
  const next = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(next) ? next : null;
}

export function CustomColorPicker({
  value,
  onChange,
  ariaLabel,
  colors = DEFAULT_COLORS,
  compact = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  colors?: string[];
  compact?: boolean;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => setDraft(value.toUpperCase()), [value]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div
      ref={root}
      className={`custom-color-picker${compact ? " compact" : ""}`}
    >
      <button
        type="button"
        className="custom-color-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span style={{ backgroundColor: value }} aria-hidden />
        {compact ? null : <strong>{value.toUpperCase()}</strong>}
      </button>
      {open ? (
        <div
          className="custom-color-picker-popover"
          role="dialog"
          aria-label={`${ariaLabel}选色器`}
        >
          <div className="custom-color-picker-swatches">
            {colors.map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`选择颜色 ${color}`}
                aria-pressed={color.toUpperCase() === value.toUpperCase()}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color.toUpperCase());
                  setDraft(color.toUpperCase());
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label>
            <span>十六进制颜色</span>
            <input
              type="text"
              inputMode="text"
              maxLength={7}
              value={draft}
              aria-label={`${ariaLabel}十六进制值`}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setDraft(next);
                const normalized = normalizeColor(next);
                if (normalized) onChange(normalized);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && normalizeColor(draft))
                  setOpen(false);
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
