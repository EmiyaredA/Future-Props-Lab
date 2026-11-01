import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useAudience,
  type AudienceOverlay,
} from "../src/features/presentation-workshop/playback/useAudience";
import { newDeck } from "../src/features/presentation-workshop/templates";
import { AUTH_REQUIRED_EVENT } from "../src/platform/api/studioAuth";
const messages: unknown[] = [];
class Channel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(value: unknown) {
    messages.push(value);
  }
  close = vi.fn();
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  messages.length = 0;
});
it("StrictMode 清理后标注仍同步，切空间结束观众窗口", () => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", Channel);
  const close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ close } as unknown as Window);
  const deck = newDeck("blank");
  const overlay: AudienceOverlay = {
    marks: [],
    draft: null,
    laser: null,
    blackboard: false,
    index: 0,
  };
  const { result, rerender, unmount } = renderHook(
    ({ overlay }) =>
      useAudience({ deck, projectId: "project", index: 0, step: 0, overlay }),
    {
      initialProps: { overlay },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  );
  act(() => result.current.open());
  rerender({ overlay: { ...overlay, blackboard: true } });
  act(() => vi.advanceTimersByTime(55));
  expect(messages).toContainEqual({
    type: "overlay",
    overlay: { ...overlay, blackboard: true },
  });
  act(() => window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT)));
  expect(close).toHaveBeenCalledOnce();
  expect(messages).toContainEqual({ type: "close" });
  unmount();
});
