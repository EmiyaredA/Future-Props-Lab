import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";

export type AnnotationSelectOption = {
  value: string;
  label: string;
  color?: string;
  tone?: string;
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

function optionIndex(
  options: AnnotationSelectOption[],
  value: string | null | undefined,
) {
  if (!value) return -1;
  return options.findIndex((option) => option.value === value);
}

export function AnnotationCollapsedSelect({
  ariaLabel,
  emptyLabel,
  multiple = false,
  options,
  trailing,
  triggerLabel,
  value,
  values = [],
  onChange,
  onToggle,
}: {
  ariaLabel: string;
  emptyLabel: string;
  multiple?: boolean;
  options: AnnotationSelectOption[];
  trailing?: ReactNode;
  triggerLabel?: string;
  value?: string | null;
  values?: string[];
  onChange?: (value: string | null) => void;
  onToggle?: (value: string, selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useSelectPopover(open, trigger, menu, 280, 220, "start");
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();

  const selectedValues = multiple ? values : [value ?? ""];
  const selectedOptions = options.filter((option) =>
    multiple
      ? option.value
        ? selectedValues.includes(option.value)
        : selectedValues.length === 0
      : selectedValues.includes(option.value),
  );
  const summary =
    triggerLabel ??
    (selectedOptions.length
      ? selectedOptions.map((option) => option.label).join("、")
      : emptyLabel);
  const leadingOption = selectedOptions[0];
  const showLeading =
    Boolean(leadingOption?.color) || Boolean(leadingOption?.tone);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) trigger.current?.focus();
  };

  const openMenu = (preferredIndex = 0) => {
    setActiveIndex(
      preferredIndex >= 0 && preferredIndex < options.length
        ? preferredIndex
        : 0,
    );
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    setActiveIndex(
      (current) => (current + direction + options.length) % options.length,
    );
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (multiple) {
      if (!option.value) {
        onToggle?.("", true);
        return;
      }
      const selected = selectedValues.includes(option.value);
      onToggle?.(option.value, !selected);
      return;
    }
    onChange?.(option.value || null);
    closeMenu(true);
  };

  const handleListKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  return (
    <div className="annotation-collapsed-select" ref={root}>
      <div className="annotation-collapsed-select-row">
        <button
          ref={trigger}
          type="button"
          role="combobox"
          className="annotation-collapsed-select-trigger"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() =>
            open
              ? closeMenu()
              : openMenu(
                  multiple
                    ? optionIndex(options, selectedValues[0])
                    : optionIndex(options, value),
                )
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu(
                multiple
                  ? optionIndex(options, selectedValues[0])
                  : optionIndex(options, value),
              );
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (open) choose(activeIndex);
              else openMenu();
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              closeMenu(true);
            }
          }}
        >
          <span className="annotation-collapsed-select-summary">
            {showLeading ? (
              <i
                className={leadingOption?.tone}
                style={
                  leadingOption?.color
                    ? { background: leadingOption.color }
                    : undefined
                }
                aria-hidden
              />
            ) : null}
            <span>{summary}</span>
          </span>
          <Chevron open={open} />
        </button>
        {trailing}
      </div>
      {open ? (
        <div
          ref={menu}
          popover="manual"
          className="annotation-collapsed-select-menu"
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable={multiple || undefined}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => {
            const selected = multiple
              ? option.value
                ? selectedValues.includes(option.value)
                : selectedValues.length === 0
              : selectedValues.includes(option.value);
            return (
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`${selected || index === activeIndex ? "selected" : ""}${option.tone ? ` ${option.tone}` : ""}`}
                tabIndex={-1}
                key={option.value || "__empty"}
                onClick={() => choose(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option.color ? (
                  <i style={{ background: option.color }} aria-hidden />
                ) : option.tone ? (
                  <i aria-hidden />
                ) : null}
                <span>{option.label}</span>
                {selected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
