export function volumeInputError(raw: string, minimum = 0): string {
  const volume = Number(raw);
  return !raw.trim() || !Number.isFinite(volume) || volume < minimum || volume > 4
    ? `请输入 ${minimum}～4 之间的音量倍数；10% 音量请填 0.1。`
    : "";
}
