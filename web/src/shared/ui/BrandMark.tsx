export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
    >
      <rect x="3" y="3" width="42" height="42" rx="11" />
      <path d="m24 10 12 7v14l-12 7-12-7V17l12-7Z" />
      <path d="m12 17 12 7 12-7M24 24v14" />
      <circle cx="24" cy="24" r="3.2" />
    </svg>
  );
}
