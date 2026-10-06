import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorInspector } from "@features/video-editor/VideoEditorInspector";
import type { VideoEditorClip } from "@features/video-editor/types";

const clip = {
  id: "audio-1",
  trackId: "audio-1",
  kind: "audio",
  name: "声音",
  assetId: "asset-1",
  timelineStartUs: 1_000_000,
  durationUs: 5_000_000,
  sourceInUs: 0,
  sourceLoop: false,
  fitMode: "cover",
  flipX: false,
  fontSize: 72,
  textColor: "#ffffff",
  volume: 1,
  keyframes: [],
} as VideoEditorClip;

function setup(current = clip, commit = vi.fn().mockResolvedValue(undefined)) {
  const view = render(
    <VideoEditorInspector
      clip={current}
      playheadUs={2_000_000}
      commit={commit}
    />,
  );
  return {
    ...view,
    commit,
    input: screen.getByRole("spinbutton", { name: "音量" }),
  };
}

describe("clip volume editing", () => {
  it.each(["10", "-1", "", "1e309"])(
    "rejects invalid input %j locally and can save a corrected value",
    async (value) => {
      const { input, commit } = setup();
      fireEvent.change(input, { target: { value } });
      expect(commit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("0～4");
      expect(input).toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(input);
      expect(commit).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: "0.1" } });
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.blur(input);
      expect(commit).toHaveBeenCalledExactlyOnceWith(
        [{ type: "updateClip", clipId: clip.id, patch: { volume: 0.1 } }],
        [{ type: "updateClip", clipId: clip.id, patch: { volume: 1 } }],
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(input).toHaveAccessibleDescription(/1 为原始音量，0.1 为 10%/);
    },
  );

  it.each([0, 4])("saves the valid boundary %s", (volume) => {
    const { input, commit } = setup();
    fireEvent.change(input, { target: { value: String(volume) } });
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledWith(
      [{ type: "updateClip", clipId: clip.id, patch: { volume } }],
      [{ type: "updateClip", clipId: clip.id, patch: { volume: 1 } }],
    );
  });

  it("validates video audio by the same rule", () => {
    const { input, commit } = setup({ ...clip, kind: "video" });
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("updates the displayed value after undo, redo, or selecting another clip", () => {
    const { rerender, input, commit } = setup();
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    rerender(
      <VideoEditorInspector
        clip={{ ...clip, volume: 0.5 }}
        playheadUs={0}
        commit={commit}
      />,
    );
    expect(input).toHaveValue(0.5);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <VideoEditorInspector
        clip={{ ...clip, id: "other", volume: 0.2 }}
        playheadUs={0}
        commit={commit}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "音量" })).toHaveValue(0.2);
  });

  it("saves with Enter and restores the saved value with Escape", () => {
    const { input, commit } = setup();
    input.focus();
    fireEvent.change(input, { target: { value: "0.2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue(1);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("validates the keyframe entry and submits the current volume in one reversible batch", () => {
    const { input, commit } = setup();
    const button = screen.getByRole("button", { name: "为音量添加关键帧" });
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(button);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "0.1" } });
    fireEvent.blur(input, { relatedTarget: button });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(button);
    const keyframe = expect.objectContaining({
      property: "volume",
      value: 0.1,
      timeUs: 1_000_000,
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith(
      [
        { type: "updateClip", clipId: clip.id, patch: { volume: 0.1 } },
        { type: "addKeyframe", clipId: clip.id, keyframe },
      ],
      [
        {
          type: "removeKeyframe",
          clipId: clip.id,
          keyframeId: expect.any(String),
        },
        { type: "updateClip", clipId: clip.id, patch: { volume: 1 } },
      ],
    );
  });

  it("retains the draft and displays a real save failure", async () => {
    const commit = vi.fn().mockRejectedValue(new Error("服务器不可用"));
    const { input } = setup(clip, commit);
    fireEvent.change(input, { target: { value: "0.1" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("服务器不可用");
    expect(input).toHaveValue(0.1);
  });

  it("disables the volume field and keyframe for a read-only inspector", () => {
    render(
      <VideoEditorInspector
        clip={clip}
        playheadUs={0}
        commit={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "音量" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "为音量添加关键帧" }),
    ).toBeDisabled();
  });
});
