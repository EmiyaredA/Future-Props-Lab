import "@shared/ui/custom-date-input.css";

export function CustomDateInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="custom-date-input">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
        <path d="M6.5 2.8v3.4M13.5 2.8v3.4M3 8.2h14" />
      </svg>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        placeholder="YYYY-MM-DD"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/[^0-9-]/g, "").slice(0, 10))
        }
      />
    </div>
  );
}
