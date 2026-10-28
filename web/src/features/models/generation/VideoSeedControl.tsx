import type { VideoCapabilities } from "./videoCapabilities";

export function VideoSeedControl({
  capabilities,
  value,
  onChange,
  onCommit,
}: {
  capabilities?: VideoCapabilities | null;
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: number | null) => void;
}) {
  if (!capabilities?.supports_seed) return null;
  return (
    <label>
      <span>随机种子（可选）</span>
      <input
        aria-label="随机种子"
        type="number"
        step="any"
        value={value}
        placeholder="随机"
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw);
          if (!raw) onCommit?.(null);
          else {
            const seed = Number(raw);
            if (
              Number.isSafeInteger(seed) &&
              seed >= capabilities.seed_minimum &&
              seed <= capabilities.seed_maximum
            )
              onCommit?.(seed);
          }
        }}
      />
    </label>
  );
}
