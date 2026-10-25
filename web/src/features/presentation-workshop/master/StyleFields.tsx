import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
export function Numeric({
  label,
  value,
  onChange,
  min = 0,
  max = 4096,
  caption,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  caption?: string;
}) {
  return (
    <label className="master-field">
      <span>{caption ?? label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}
export function Color({
  label,
  caption,
  value,
  onChange,
}: {
  label: string;
  caption?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="master-color">
      <span>{caption ?? label}</span>
      <CustomColorPicker ariaLabel={label} value={value} onChange={onChange} />
    </label>
  );
}
