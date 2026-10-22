import { useRef } from "react";

export function AcceptanceChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options
    .map((option, index) => (!disabled && !option.disabled ? index : -1))
    .filter((index) => index >= 0);
  const active = options.findIndex((option) => option.value === value);
  return (
    <div className="acceptance-choice" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          type="button"
          role="radio"
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          aria-checked={value === option.value}
          disabled={disabled || option.disabled}
          tabIndex={
            index === (enabled.includes(active) ? active : enabled[0]) ? 0 : -1
          }
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key) ||
              !enabled.length
            )
              return;
            event.preventDefault();
            const offset =
              event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            const target =
              event.key === "Home"
                ? enabled[0]
                : event.key === "End"
                  ? enabled.at(-1)!
                  : enabled[
                      (enabled.indexOf(index) + offset + enabled.length) %
                        enabled.length
                    ];
            onChange(options[target].value);
            buttons.current[target]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
