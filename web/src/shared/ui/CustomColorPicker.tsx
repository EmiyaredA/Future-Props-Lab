import { useEffect, useRef, useState } from "react";
import "@shared/ui/custom-color-picker.css";
import { useSelectPopover } from "./useSelectPopover";

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
  mixed = false,
  disabled = false,
  open: openProp,
  onOpenChange,
  placement = "anchor",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  colors?: string[];
  compact?: boolean;
  mixed?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: "anchor" | "center";
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    onOpenChange?.(resolved);
    if (openProp === undefined) setUncontrolledOpen(resolved);
  };
  useSelectPopover(
    open,
    trigger,
    menu,
    280,
    224,
    placement === "center" ? "center" : "end",
  );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => setDraft(value.toUpperCase()), [value]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target)) return;
      if (menu.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div
      ref={root}
      className={`custom-color-picker${compact ? " compact" : ""}${placement === "center" && open ? " is-centered" : ""}`}
    >
      {placement === "center" && open ? (
        <button
          type="button"
          className="custom-color-picker-backdrop"
          aria-label="关闭选色器"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <button
        ref={trigger}
        type="button"
        title={mixed ? `${ariaLabel}：混合` : ariaLabel}
        className="custom-color-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          style={{
            background: mixed
              ? "linear-gradient(135deg, #777 50%, #ddd 50%)"
              : value,
          }}
          aria-hidden
        />
        {compact ? null : (
          <strong>{mixed ? "混合" : value.toUpperCase()}</strong>
        )}
      </button>
      {open ? (
        <div
          ref={menu}
          popover="manual"
          className="custom-color-picker-popover"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
            if (
              !(event.target instanceof HTMLInputElement) &&
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            ) {
              event.preventDefault();
              const buttons = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>("button") ??
                  [],
              );
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              const delta =
                event.key === "ArrowLeft"
                  ? -1
                  : event.key === "ArrowUp"
                    ? -5
                    : event.key === "ArrowDown"
                      ? 5
                      : 1;
              buttons[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index + delta + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
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
                  close();
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
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
                if (event.key === "Enter" && normalizeColor(draft)) close();
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
