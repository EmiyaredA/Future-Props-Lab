const UNITS = ["B", "KB", "MB", "GB"] as const;
type FileSizeUnit = (typeof UNITS)[number];

export function formatFileSize(
  value: number | null | undefined,
  options: {
    emptyLabel?: string;
    minimumUnit?: FileSizeUnit;
    fractionalDigits?: number;
  } = {},
): string {
  if (value == null) return options.emptyLabel ?? "—";
  const bytes = Math.max(0, value);
  const minimumIndex = UNITS.indexOf(options.minimumUnit ?? "B");
  const naturalIndex = Math.min(
    UNITS.length - 1,
    bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0,
  );
  const unitIndex = Math.max(minimumIndex, naturalIndex);
  const scaled = bytes / 1024 ** unitIndex;
  if (unitIndex === 0) return `${Math.round(scaled)} B`;
  const digits = unitIndex > minimumIndex ? 1 : (options.fractionalDigits ?? 1);
  const rendered =
    digits === 0
      ? String(Math.max(bytes > 0 ? 1 : 0, Math.round(scaled)))
      : scaled.toFixed(digits);
  return `${rendered} ${UNITS[unitIndex]}`;
}
