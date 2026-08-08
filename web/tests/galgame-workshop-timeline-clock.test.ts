import { afterEach, describe, expect, test, vi } from "vitest";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";

afterEach(() => vi.useRealTimers());

describe("Galgame independent timeline clock", () => {
  test("continues independently, pauses, seeks, and finishes at story duration", () => {
    vi.useFakeTimers();
    const positions: number[] = [];
    const playing: boolean[] = [];
    const finished = vi.fn();
    const clock = new TimelineClock(300, {
      onPosition: (position) => positions.push(position),
      onPlayingChange: (value) => playing.push(value),
      onFinish: finished,
    });

    clock.play();
    vi.advanceTimersByTime(120);
    expect(positions.at(-1)).toBeGreaterThanOrEqual(90);
    clock.pause();
    const pausedAt = clock.position;
    vi.advanceTimersByTime(100);
    expect(clock.position).toBe(pausedAt);

    clock.seek(250);
    clock.play();
    vi.advanceTimersByTime(100);
    expect(clock.position).toBe(300);
    expect(finished).toHaveBeenCalledOnce();
    expect(playing).toEqual([true, false, true, false]);
    clock.dispose();
  });

  test("adopts an expanded story duration without resetting position", () => {
    vi.useFakeTimers();
    const clock = new TimelineClock(100, { onPosition: () => undefined });
    clock.seek(80);
    clock.setDuration(500);
    expect(clock.position).toBe(80);
    clock.play();
    vi.advanceTimersByTime(200);
    expect(clock.position).toBeGreaterThan(250);
    expect(clock.position).toBeLessThan(500);
    clock.dispose();
  });

  test("plays one manual beat and pauses without finishing the timeline", () => {
    vi.useFakeTimers();
    const finished = vi.fn();
    const clock = new TimelineClock(1000, {
      onPosition: () => undefined,
      onFinish: finished,
    });
    clock.seek(100);
    clock.playUntil(400);
    vi.advanceTimersByTime(500);
    expect(clock.position).toBe(400);
    expect(clock.isPlaying).toBe(false);
    expect(finished).not.toHaveBeenCalled();

    clock.play();
    vi.advanceTimersByTime(700);
    expect(clock.position).toBe(1000);
    expect(finished).toHaveBeenCalledOnce();
  });
});
