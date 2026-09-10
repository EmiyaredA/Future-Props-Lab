export function NumberField({
  label,
  value,
  min = -10000,
  max = 10000,
  step = 1,
  onChange,
  mixed = false,
}: {
  label: string;
  value: number;
  mixed?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="presentation-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={mixed ? "" : Math.round(value * 100) / 100}
        placeholder={mixed ? "混合" : undefined}
        onChange={(e) => {
          if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
            onChange(Math.max(min, Math.min(max, Number(e.target.value))));
        }}
      />
    </label>
  );
}
