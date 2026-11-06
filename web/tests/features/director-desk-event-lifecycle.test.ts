import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bindEvents } from "@features/director-desk/editor/ui/events";
import type { AppContext } from "@features/director-desk/editor/app-context";

vi.mock("@features/director-desk/editor/ui/timeline-input", () => ({
  bindTimelineInput: () => undefined,
}));

describe("director editor event lifecycle", () => {
  it("keeps unrelated listeners and responds once after remount", () => {
    document.body.innerHTML = `<button id="outside" data-act="outside">外部</button><div class="director-desk-root"><button data-act="save">保存</button><canvas id="stage-canvas"></canvas></div>`;
    const outside = vi.fn();
    document.addEventListener("click", outside);
    const first = new AbortController();
    const firstAct = vi.fn();
    bindEvents({
      signal: first.signal,
      act: firstAct,
    } as unknown as AppContext);
    fireEvent.click(document.getElementById("outside")!);
    expect(firstAct).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-act="save"]')!);
    expect(firstAct).toHaveBeenCalledTimes(1);
    first.abort();
    const second = new AbortController();
    const secondAct = vi.fn();
    bindEvents({
      signal: second.signal,
      act: secondAct,
    } as unknown as AppContext);
    fireEvent.click(document.querySelector('[data-act="save"]')!);
    expect(firstAct).toHaveBeenCalledTimes(1);
    expect(secondAct).toHaveBeenCalledTimes(1);
    expect(outside).toHaveBeenCalledTimes(3);
    second.abort();
    document.removeEventListener("click", outside);
  });
});
