import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_LAYOUT,
  normalizeEditorLayout,
  resolveEditorLayout,
} from "@features/video-editor/editorLayout";
import { VideoEditorSeparator } from "@features/video-editor/VideoEditorSeparator";
import {
  defaultVideoEditorWorkspacePreferences,
  loadVideoEditorWorkspacePreferences,
  storeVideoEditorWorkspacePreferences,
} from "@features/video-editor/workspacePreferences";

describe("video editor panel layout", () => {
  it("clamps rendered sizes without losing the desired layout", () => {
    const desired = {
      ...DEFAULT_EDITOR_LAYOUT,
      assetWidth: 480,
      inspectorWidth: 520,
      timelineRatio: 0.9,
    };
    const small = resolveEditorLayout(desired, 1160, 600);
    expect(small.assetWidth + small.inspectorWidth).toBeCloseTo(748);
    expect(small.assetWidth).toBeGreaterThanOrEqual(200);
    expect(small.inspectorWidth).toBeGreaterThanOrEqual(280);
    expect(small.availableHeight - small.timelineHeight).toBe(220);
    const large = resolveEditorLayout(desired, 1920, 1200);
    expect(large.assetWidth).toBe(480);
    expect(large.inspectorWidth).toBe(520);
    expect(desired.timelineRatio).toBe(0.9);
    expect(
      resolveEditorLayout(DEFAULT_EDITOR_LAYOUT, 1160, 300).timelineHeight,
    ).toBe(180);
  });

  it("restores layout and both scroll axes separately per project", () => {
    const preferences = {
      ...defaultVideoEditorWorkspacePreferences(),
      timelineScrollLeft: 480,
      timelineScrollTop: 560,
      layout: {
        assetWidth: 380,
        inspectorWidth: 450,
        trackHeaderWidth: 240,
        timelineRatio: 0.55,
      },
    };
    storeVideoEditorWorkspacePreferences("layout-a", preferences);
    expect(loadVideoEditorWorkspacePreferences("layout-a")).toEqual(
      preferences,
    );
    expect(loadVideoEditorWorkspacePreferences("layout-b")).toEqual(
      defaultVideoEditorWorkspacePreferences(),
    );
    expect(
      normalizeEditorLayout({
        assetWidth: -50,
        inspectorWidth: Infinity,
        trackHeaderWidth: 500,
        timelineRatio: "bad",
      }),
    ).toEqual({
      assetWidth: 200,
      inspectorWidth: 340,
      trackHeaderWidth: 320,
      timelineRatio: 0.35,
    });
  });

  it("tolerates unavailable browser storage", () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("full");
      });
    try {
      expect(loadVideoEditorWorkspacePreferences("blocked")).toEqual(
        defaultVideoEditorWorkspacePreferences(),
      );
      expect(() =>
        storeVideoEditorWorkspacePreferences(
          "blocked",
          defaultVideoEditorWorkspacePreferences(),
        ),
      ).not.toThrow();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  function Control({ reverse = false }: { reverse?: boolean }) {
    const [value, setValue] = useState(250);
    return (
      <VideoEditorSeparator
        label="调整宽度"
        orientation="vertical"
        value={value}
        min={200}
        max={480}
        reverse={reverse}
        onChange={setValue}
        onReset={() => setValue(250)}
      />
    );
  }
  it("resizes with keyboard steps and resets with a double click", () => {
    render(<Control />);
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "260");
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute("aria-valuenow", "250");
  });
  it.each(["pointercancel", "blur", "Escape"])(
    "rolls back a drag on %s",
    async (reason) => {
      render(<Control />);
      const separator = screen.getByRole("separator");
      fireEvent(
        separator,
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 250,
        }),
      );
      fireEvent(window, new MouseEvent("pointermove", { clientX: 400 }));
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      expect(separator).toHaveAttribute("aria-valuenow", "400");
      if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else fireEvent(window, new Event(reason));
      expect(separator).toHaveAttribute("aria-valuenow", "250");
      fireEvent(window, new MouseEvent("pointerup", { clientX: 470 }));
      expect(separator).toHaveAttribute("aria-valuenow", "250");
    },
  );
  it("commits the final pointer position before a scheduled frame and clamps it", () => {
    render(<Control reverse />);
    const separator = screen.getByRole("separator");
    fireEvent(
      separator,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 }),
    );
    fireEvent(window, new MouseEvent("pointermove", { clientX: 450 }));
    fireEvent(window, new MouseEvent("pointerup", { clientX: 0 }));
    expect(separator).toHaveAttribute("aria-valuenow", "480");
  });
});
