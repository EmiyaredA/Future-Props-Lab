import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryAutosave } from "@features/director-desk/editor/editor/recovery-autosave";

afterEach(() => vi.useRealTimers());

describe("director editor recovery autosave lifecycle", () => {
  it("does not write or notify after disposal", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => true);
    const saved = vi.fn();
    const failed = vi.fn();
    const recovery = new RecoveryAutosave(write, saved, failed, 50);
    recovery.request();
    recovery.dispose();
    await vi.runAllTimersAsync();
    expect(write).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
