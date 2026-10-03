import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PetRuntime } from "../src/features/desktop-pet/PetRuntime";

const state = vi.hoisted(() => ({
  roam: "calm",
  linked: false,
  chat: null as ((value: { phase: string }) => void) | null,
  refresh: null as (() => void) | null,
  revision: 1,
}));
vi.mock("../src/features/desktop-pet/usePetPreview", () => ({
  usePetPreview: () => ({
    linked: state.linked,
    paused: state.linked,
    display: null,
    error: "",
  }),
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  getChat: async () => ({ proactiveLinesEnabled: false }),
  getDocument: async () => ({
    revision: state.revision,
    sourceType: "coopanion-whale",
    whaleModel: { schemes: [{ id: "deepseek" }] },
    config: {
      events: { roam: { motionId: "walk" } },
      habits: {
        roam: state.roam,
        size: 220,
        draggable: true,
        bubbles: false,
        sound: false,
        hoverActions: ["roam"],
      },
    },
  }),
}));
vi.mock("../src/features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: forwardRef(function Figure(
    {
      eventName,
      document,
    }: { eventName: string; document: { revision: number } },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ hitTest: () => true }));
    return (
      <div data-testid="figure" data-revision={document.revision}>
        {eventName}
      </div>
    );
  }),
}));

const move = vi.fn();
const previousDesktop = window.futurePropsDesktop;
beforeEach(() => {
  vi.useFakeTimers();
  state.roam = "calm";
  state.linked = false;
  state.chat = null;
  state.refresh = null;
  state.revision = 1;
  vi.spyOn(Math, "random").mockReturnValue(0.9);
  move
    .mockReset()
    .mockImplementation(async (x: number, y: number) => ({ x, y }));
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: {
      movePet: move,
      setPetInteractive: vi.fn(),
      onPetChatState: (callback: typeof state.chat) => {
        state.chat = callback;
        return () => {
          state.chat = null;
        };
      },
      onPetResourcesChanged: (callback: () => void) => {
        state.refresh = callback;
        return () => {
          state.refresh = null;
        };
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "futurePropsDesktop", {
    configurable: true,
    value: previousDesktop,
  });
});

async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<PetRuntime projectId="pet-1" />);
  });
  fireEvent.pointerMove(view.container.firstElementChild!);
  return view;
}

test("resource refresh updates the figure without interrupting chat state and ignores stale snapshots", async () => {
  const view = await mount();
  await act(async () => state.chat?.({ phase: "thinking" }));
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.revision = 2;
  await act(async () => state.refresh?.());
  expect(screen.getByTestId("figure")).toHaveAttribute("data-revision", "2");
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.revision = 1;
  await act(async () => state.refresh?.());
  expect(screen.getByTestId("figure")).toHaveAttribute("data-revision", "2");
  view.unmount();
  expect(state.refresh).toBeNull();
});

test("calm roaming moves after 17 seconds and stops after unmount", async () => {
  const view = await mount();
  await act(() => vi.advanceTimersByTimeAsync(16999));
  expect(move).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(move).toHaveBeenCalledWith(25, 0);
  expect(screen.getByTestId("figure")).toHaveTextContent("roam");
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("switching modes shows the current state, moves immediately, and off stops the timer", async () => {
  await mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "走动：多待着" })),
  );
  expect(screen.getByRole("button", { name: "走动：常走动" })).toBeVisible();
  expect(move).toHaveBeenLastCalledWith(55, 0);
  await act(() => vi.advanceTimersByTimeAsync(7000));
  expect(move).toHaveBeenLastCalledWith(110, 0);
  fireEvent.click(screen.getByRole("button", { name: "走动：常走动" }));
  expect(screen.getByRole("button", { name: "走动：不乱动" })).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(move).toHaveBeenCalledTimes(2);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "走动：不乱动" })),
  );
  expect(move).toHaveBeenLastCalledWith(135, 0);
});

test("a clamped screen-edge move tries the opposite direction", async () => {
  await mount();
  move.mockResolvedValueOnce({ x: 0, y: 0 });
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move.mock.calls).toEqual([
    [25, 0],
    [-25, 0],
  ]);
});

test("roaming waits while chatting and resumes after closing chat", async () => {
  await mount();
  act(() => state.chat?.({ phase: "open" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).not.toHaveBeenCalled();
  await act(async () => state.chat?.({ phase: "closed" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("starting or releasing a paused link preserves the active chat reaction", async () => {
  const view = await mount();
  act(() => {
    state.chat?.({ phase: "open" });
    state.chat?.({ phase: "thinking" });
  });
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  state.linked = true;
  view.rerender(<PetRuntime projectId="pet-1" />);
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).not.toHaveBeenCalled();
  state.linked = false;
  view.rerender(<PetRuntime projectId="pet-1" />);
  expect(screen.getByTestId("figure")).toHaveTextContent("chatThinking");
  await act(async () => state.chat?.({ phase: "closed" }));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(move).toHaveBeenCalledTimes(1);
});

test("a failed move displays an error and a later successful move clears it", async () => {
  await mount();
  move.mockRejectedValueOnce(new Error("IPC unavailable"));
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(screen.getByRole("alert")).toHaveTextContent("走动失败");
  await act(() => vi.advanceTimersByTimeAsync(17000));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("disabling roaming ignores a pending receipt and does not request an edge retry", async () => {
  state.roam = "free";
  await mount();
  let resolve!: (bounds: { x: number; y: number }) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => vi.advanceTimersByTimeAsync(7000));
  fireEvent.click(screen.getByRole("button", { name: "走动：常走动" }));
  await act(async () => resolve({ x: 0, y: 0 }));
  expect(move).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("figure")).toHaveTextContent("idle");
});

test("a slow host response does not overlap another roaming request", async () => {
  await mount();
  let resolve!: (bounds: { x: number; y: number }) => void;
  move.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => vi.advanceTimersByTimeAsync(34000));
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ x: 25, y: 0 }));
  expect(screen.getByTestId("figure")).toHaveTextContent("roam");
});
