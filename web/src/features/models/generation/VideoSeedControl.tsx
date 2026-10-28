import type { VideoCapabilities } from "./videoCapabilities";

export function VideoSeedControl({
  capabilities,
  value,
  onChange,
}: {
  capabilities?: VideoCapabilities | null;
  value: string;
  onChange: (value: string) => void;
}) {
  if (!capabilities?.supports_seed) return null;
  return (
    <label>
      <span>随机种子（可选）</span>
      <input
        aria-label="随机种子"
        type="number"
        step="1"
        min={capabilities.seed_minimum}
        max={capabilities.seed_maximum}
        value={value}
        placeholder="随机"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
