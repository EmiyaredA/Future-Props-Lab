import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useBackdropDismiss } from "@shared/ui/useBackdropDismiss";

function Harness({
  dismiss,
  nested = false,
}: {
  dismiss: () => void;
  nested?: boolean;
}) {
  const backdrop = useBackdropDismiss(dismiss);
  return (
    <dialog open aria-label="编辑" {...backdrop}>
      <button>内部</button>
      {nested && (
        <dialog open aria-label="子弹窗">
          <button>子内容</button>
        </dialog>
      )}
    </dialog>
  );
}

function clickAt(element: HTMLElement, x: number, y: number) {
  pointerDown(element, x, y);
  fireEvent.click(element, { button: 0, clientX: x, clientY: y });
}

function pointerDown(element: HTMLElement, clientX: number, clientY: number) {
  // jsdom lacks PointerEvent; retain browser coordinates in a MouseEvent.
  fireEvent(
    element,
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
}

test("native backdrop closes, while dialog padding, content and drag-out do not", () => {
  const dismiss = vi.fn();
  render(<Harness dismiss={dismiss} nested />);
  const dialog = screen.getByRole("dialog", { name: "编辑" });
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 500,
    bottom: 400,
  } as DOMRect);
  clickAt(dialog, 110, 110);
  clickAt(screen.getByRole("button", { name: "内部" }), 120, 120);
  clickAt(screen.getByRole("dialog", { name: "子弹窗" }), 20, 20);
  pointerDown(dialog, 110, 110);
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  pointerDown(dialog, 20, 20);
  fireEvent.pointerCancel(dialog);
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  expect(dismiss).not.toHaveBeenCalled();
  clickAt(dialog, 20, 20);
  expect(dismiss).toHaveBeenCalledTimes(1);
});
