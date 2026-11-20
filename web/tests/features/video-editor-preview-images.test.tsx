import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorEffectImage } from "@features/video-editor/VideoEditorEffectImage";

describe("program monitor image presentation", () => {
  it.each([
    ["transparent character", "/v1/files/character/content"],
    ["rendered text", "blob:rendered-text"],
  ])("keeps a pending %s transparent over lower tracks", (_name, source) => {
    const view = render(
      <VideoEditorEffectImage source={source} alt="overlay" />,
    );
    const image = screen.getByAltText("overlay");
    // A loading skeleton fills the entire transparent PNG rectangle, obscuring
    // the composition whenever a short mouth/blink clip first mounts.
    expect(
      view.container.querySelector('[data-load-state="loading"]'),
    ).toBeNull();
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("decoding", "sync");
    fireEvent.load(image);
    expect(
      view.container.querySelector('[data-load-state="loading"]'),
    ).toBeNull();
  });

  it("does not reintroduce a loading surface when short overlays remount", () => {
    const view = render(
      <VideoEditorEffectImage key="mouth-1" source="/mouth.png" />,
    );
    fireEvent.load(view.container.querySelector("img")!);
    view.rerender(<VideoEditorEffectImage key="mouth-2" source="/mouth.png" />);
    expect(
      view.container.querySelector('[data-load-state="loading"]'),
    ).toBeNull();
    expect(view.container.querySelector("canvas")).toBeNull();
  });

  it("still reports loaded text dimensions for positioning", () => {
    const onSize = vi.fn();
    const view = render(
      <VideoEditorEffectImage source="blob:text" onSize={onSize} />,
    );
    const image = view.container.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { value: 300 },
      naturalHeight: { value: 68 },
    });
    fireEvent.load(image);
    expect(onSize).toHaveBeenCalledWith({ width: 300, height: 68 });
  });
});
