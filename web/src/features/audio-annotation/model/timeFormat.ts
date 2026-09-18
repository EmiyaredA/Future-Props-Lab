const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${hours ? `${pad(hours)}:` : ""}${pad(minutes)}:${pad(seconds)}.${pad(safe % 1000, 3)}`;
}

export function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsPart = parts.pop()!;
  const seconds = Number(secondsPart);
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts[0]) : 0;
  if (
    ![hours, minutes, seconds].every(Number.isFinite) ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  )
    return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function formatSrtTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(safe % 1000, 3)}`;
}
