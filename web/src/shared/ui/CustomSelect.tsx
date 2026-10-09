import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "@shared/ui/custom-select.css";
import { useSelectPopover } from "./useSelectPopover";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  swatch?: string;
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
  escapeClipping = true,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  leadingIcon?: ReactNode;
  showChevron?: boolean;
  escapeClipping?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useSelectPopover(open && escapeClipping, trigger, menu);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  const firstEnabledIndex = () =>
    options.findIndex((option) => !option.disabled);
  const lastEnabledIndex = () => {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index]?.disabled) return index;
    }
    return -1;
  };
  const selectedIndex = options.findIndex(
    (option) => option.value === value && !option.disabled,
  );

  const openMenu = (preferredIndex = selectedIndex) => {
    const nextIndex =
      preferredIndex >= 0 ? preferredIndex : firstEnabledIndex();
    setActiveIndex(nextIndex);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) trigger.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  };

  const handleListKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(
        event.key === "Home" ? firstEnabledIndex() : lastEnabledIndex(),
      );
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
    <div className={`custom-select ${className}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listId}-option-${activeIndex}`
            : undefined
        }
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const boundary =
              event.key === "ArrowDown"
                ? firstEnabledIndex()
                : lastEnabledIndex();
            openMenu(selectedIndex >= 0 ? selectedIndex : boundary);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            openMenu(
              event.key === "Home" ? firstEnabledIndex() : lastEnabledIndex(),
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
        <span className="custom-select-trigger-content">
          {leadingIcon}
          <span>{selected?.label ?? "请选择"}</span>
        </span>
        {showChevron ? <Chevron open={open} /> : null}
      </button>
      {open ? (
        <div
          ref={menu}
          popover={escapeClipping ? "manual" : undefined}
          className="custom-select-menu"
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => (
            <button
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              id={`${listId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={
                option.value === value || index === activeIndex
                  ? "selected"
                  : ""
              }
              disabled={option.disabled}
              tabIndex={-1}
              key={option.value}
              onClick={() => choose(index)}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
            >
              <span>
                {option.swatch ? (
                  <i
                    className="custom-select-swatch"
                    style={{ background: option.swatch }}
                    aria-hidden="true"
                  />
                ) : null}
                {option.label}
              </span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
