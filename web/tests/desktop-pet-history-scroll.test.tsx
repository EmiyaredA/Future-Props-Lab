import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PetChatMessage } from "../src/features/desktop-pet/api";
import { useChatHistoryScroll } from "../src/features/desktop-pet/useChatHistoryScroll";

function Reader({ streaming = "" }: { streaming?: string }) {
  const [count, setCount] = useState(5);
  const [visible, setVisible] = useState(true);
  const messages = Array.from({ length: count }, (_, id) => ({
    id: String(id),
  })) as PetChatMessage[];
  const scroll = useChatHistoryScroll(messages, "", streaming, visible);
  return (
    <>
      {visible && (
        <div
          ref={(node) => {
            scroll.history.current = node;
            if (node) {
              Object.defineProperties(node, {
                scrollHeight: {
                  configurable: true,
                  get: () => count * 100 + streaming.length,
                },
                clientHeight: { configurable: true, value: 100 },
              });
            }
          }}
          onScroll={scroll.trackScroll}
          data-testid="history"
        />
      )}
      <button
        onClick={() => {
          scroll.preservePrepend();
          setCount(count + 2);
        }}
      >
        更早的消息
      </button>
      <button onClick={scroll.scrollToLatest}>发送</button>
      <button onClick={() => setVisible(!visible)}>设置</button>
      {scroll.awayFromLatest && (
        <button onClick={scroll.scrollToLatest}>回到最新</button>
      )}
    </>
  );
}

const previousScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn(function (
    this: HTMLElement,
    options: ScrollToOptions | number,
  ) {
    const top = typeof options === "number" ? options : (options.top ?? 0);
    this.scrollTop = Math.max(
      0,
      Math.min(top, this.scrollHeight - this.clientHeight),
    );
  });
});
afterEach(() => {
  HTMLElement.prototype.scrollTo = previousScrollTo;
  vi.restoreAllMocks();
});

test("prepending history preserves the reader's anchor and returning from settings preserves its position", async () => {
  render(<Reader />);
  const element = screen.getByTestId("history");
  expect(element.scrollTop).toBe(400);
  element.scrollTop = 20;
  fireEvent.scroll(element);
  await userEvent.click(screen.getByRole("button", { name: "更早的消息" }));
  expect(element.scrollTop).toBe(220);
  expect(screen.getByRole("button", { name: "回到最新" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "设置" }));
  await userEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(screen.getByTestId("history").scrollTop).toBe(220);
});

test("streaming follows within 48px, leaves a reader above that threshold in place, and sending resumes following", async () => {
  const view = render(<Reader />);
  const element = screen.getByTestId("history");
  element.scrollTop = 351;
  fireEvent.scroll(element);
  view.rerender(<Reader streaming={"回复".repeat(50)} />);
  expect(element.scrollTop).toBe(351);
  element.scrollTop = 452;
  fireEvent.scroll(element);
  view.rerender(<Reader streaming={"回复".repeat(100)} />);
  expect(element.scrollTop).toBe(600);
  element.scrollTop = 10;
  fireEvent.scroll(element);
  await userEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(element.scrollTop).toBe(600);
  expect(
    screen.queryByRole("button", { name: "回到最新" }),
  ).not.toBeInTheDocument();
});
