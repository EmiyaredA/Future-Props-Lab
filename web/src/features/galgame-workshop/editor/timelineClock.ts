const CLOCK_INTERVAL_MS = 33;

type TimelineClockCallbacks = {
  onPosition: (milliseconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onFinish?: () => void;
  onBoundary?: (milliseconds: number) => void;
  positionSource?: () => number | undefined;
};

export class TimelineClock {
  private durationMs: number;
  private positionMs = 0;
  private playing = false;
  private startedAtMs = 0;
  private startedPositionMs = 0;
  private stopAtMs: number | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(
    durationMs: number,
    private readonly callbacks: TimelineClockCallbacks,
  ) {
    this.durationMs = Math.max(1, durationMs);
  }

  get position() {
    return this.positionMs;
  }

  get isPlaying() {
    return this.playing;
  }

  setDuration(durationMs: number) {
    this.durationMs = Math.max(1, durationMs);
    if (this.positionMs <= this.durationMs) return;
    this.seek(this.durationMs);
  }

  seek(milliseconds: number) {
    this.positionMs = Math.min(
      this.durationMs,
      Math.max(0, Math.round(milliseconds)),
    );
    if (this.playing) {
      this.startedAtMs = performance.now();
      this.startedPositionMs = this.positionMs;
    }
    this.callbacks.onPosition(this.positionMs);
    return this.positionMs;
  }

  play() {
    this.stopAtMs = undefined;
    if (this.playing) return;
    if (this.positionMs >= this.durationMs) this.seek(0);
    this.startPlaying();
  }

  playUntil(milliseconds: number) {
    const target = Math.min(
      this.durationMs,
      Math.max(this.positionMs, Math.round(milliseconds)),
    );
    if (target <= this.positionMs) {
      this.pause();
      return;
    }
    this.stopAtMs = target;
    if (this.playing) {
      this.startedAtMs = performance.now();
      this.startedPositionMs = this.positionMs;
      return;
    }
    this.startPlaying();
  }

  private startPlaying() {
    this.playing = true;
    this.startedAtMs = performance.now();
    this.startedPositionMs = this.positionMs;
    this.callbacks.onPlayingChange?.(true);
    this.interval = setInterval(() => this.tick(), CLOCK_INTERVAL_MS);
  }

  pause() {
    if (!this.playing) return;
    this.tick(false);
    this.clearInterval();
    this.playing = false;
    this.stopAtMs = undefined;
    this.callbacks.onPlayingChange?.(false);
  }

  dispose() {
    this.clearInterval();
    this.playing = false;
    this.stopAtMs = undefined;
  }

  private tick(allowFinish = true) {
    if (!this.playing) return;
    const limit = this.stopAtMs ?? this.durationMs;
    const sourced = this.callbacks.positionSource?.();
    const next = Math.min(
      limit,
      sourced != null && Number.isFinite(sourced)
        ? Math.max(0, sourced)
        : this.startedPositionMs + performance.now() - this.startedAtMs,
    );
    this.positionMs = Math.round(next);
    this.callbacks.onPosition(this.positionMs);
    if (!allowFinish || this.positionMs < limit) return;
    this.clearInterval();
    this.playing = false;
    this.callbacks.onPlayingChange?.(false);
    const stoppedAtBoundary = this.stopAtMs != null;
    const finished = !stoppedAtBoundary && this.positionMs >= this.durationMs;
    this.stopAtMs = undefined;
    if (stoppedAtBoundary) this.callbacks.onBoundary?.(this.positionMs);
    if (finished) this.callbacks.onFinish?.();
  }

  private clearInterval() {
    if (this.interval == null) return;
    globalThis.clearInterval(this.interval);
    this.interval = undefined;
  }
}
