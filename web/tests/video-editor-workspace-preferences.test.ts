import { describe, expect, it } from "vitest";
import {
  defaultVideoEditorWorkspacePreferences,
  loadVideoEditorWorkspacePreferences,
  storeVideoEditorWorkspacePreferences,
} from "@features/video-editor/workspacePreferences";

describe("video editor workspace preferences", () => {
  it("stores work position independently for each project", () => {
    storeVideoEditorWorkspacePreferences("editor-1", {
      version: 1,
      playheadUs: 4_200_000,
      selectedClipIds: ["clip-a", "clip-b"],
      zoom: 135,
      timelineScrollLeft: 720,
      preciseFrame: false,
    });

    expect(loadVideoEditorWorkspacePreferences("editor-1")).toEqual({
      version: 1,
      playheadUs: 4_200_000,
      selectedClipIds: ["clip-a", "clip-b"],
      zoom: 135,
      timelineScrollLeft: 720,
      preciseFrame: false,
    });
    expect(loadVideoEditorWorkspacePreferences("editor-2")).toEqual(
      defaultVideoEditorWorkspacePreferences(),
    );
  });

  it("falls back safely for corrupt and old versions", () => {
    localStorage.setItem(
      "future-props.video-editor.workspace:corrupt",
      "not json",
    );
    localStorage.setItem(
      "future-props.video-editor.workspace:old",
      JSON.stringify({ version: 0, playheadUs: 123 }),
    );

    expect(loadVideoEditorWorkspacePreferences("corrupt")).toEqual(
      defaultVideoEditorWorkspacePreferences(),
    );
    expect(loadVideoEditorWorkspacePreferences("old")).toEqual(
      defaultVideoEditorWorkspacePreferences(),
    );
  });

  it("sanitizes missing and out-of-range fields", () => {
    localStorage.setItem(
      "future-props.video-editor.workspace:editor-1",
      JSON.stringify({
        version: 1,
        playheadUs: -1,
        selectedClipIds: ["clip-a", "clip-a", 123, ""],
        zoom: 999,
        timelineScrollLeft: Number.NaN,
      }),
    );

    expect(loadVideoEditorWorkspacePreferences("editor-1")).toEqual({
      version: 1,
      playheadUs: 0,
      selectedClipIds: ["clip-a"],
      zoom: 240,
      timelineScrollLeft: 0,
      preciseFrame: true,
    });
  });
});
