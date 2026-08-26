import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  GalgameStoryAsset,
  GalgameStoryCharacterExpression,
} from "@features/galgame-workshop/api";
import { ExpressionPortrait } from "@features/galgame-workshop/editor/ExpressionPortrait";
import { portraitFootprintWidth } from "@features/galgame-workshop/editor/portraitSizing";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn(async () => new Blob(["frame"], { type: "image/png" })),
}));

const assets: GalgameStoryAsset[] = [0, 1, 2].map((index) => ({
  id: `asset-${index}`,
  type: "image",
  role: "characterPortrait",
  fileId: `file-${index}`,
  status: "ready",
}));

function expression(loop = true): GalgameStoryCharacterExpression {
  return {
    id: "expression-idle",
    label: "待机",
    assetId: "asset-0",
    renderMode: "frameSequence",
    sequence: {
      playbackMode: "timed",
      fps: 10,
      loop,
      frames: assets.map((asset, index) => ({
        id: `frame-${index}`,
        assetId: asset.id,
      })),
    },
  };
}

async function settleFrames() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ExpressionPortrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(fetchApiBlob).mockResolvedValue(
      new Blob(["frame"], { type: "image/png" }),
    );
    let index = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:expression-frame-${index++}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("preloads once, advances frames, and loops", async () => {
    const rendered = render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
      />,
    );
    await settleFrames();

    expect(fetchApiBlob).toHaveBeenCalledTimes(3);
    expect(
      rendered.container.querySelectorAll(".galgame-expression-frame-preload"),
    ).toHaveLength(3);
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-0",
    );
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-0",
    );
  });

  test("holds the final frame when looping is disabled", async () => {
    render(
      <ExpressionPortrait
        expression={expression(false)}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
      />,
    );
    await settleFrames();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-2",
    );
  });

  test("keeps layout measurements anchored to the first frame", async () => {
    const onNaturalSize = vi.fn();
    render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
        onNaturalSize={onNaturalSize}
      />,
    );
    await settleFrames();

    const portrait = screen.getByAltText("待机");
    Object.defineProperties(portrait, {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    fireEvent.load(portrait);
    expect(onNaturalSize).toHaveBeenLastCalledWith({
      width: 800,
      height: 1200,
    });

    act(() => vi.advanceTimersByTime(100));
    Object.defineProperties(portrait, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(portrait);
    expect(onNaturalSize).toHaveBeenCalledTimes(1);
  });

  test("reports the anchor size from its preload after playback advances", async () => {
    const onNaturalSize = vi.fn();
    const rendered = render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
        onNaturalSize={onNaturalSize}
      />,
    );
    await settleFrames();

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
    const anchorPreload = rendered.container.querySelector<HTMLImageElement>(
      '.galgame-expression-frame-preload[data-file-id="file-0"]',
    );
    if (!anchorPreload) throw new Error("missing anchor preload");
    Object.defineProperties(anchorPreload, {
      naturalWidth: { configurable: true, value: 1172 },
      naturalHeight: { configurable: true, value: 1472 },
    });
    fireEvent.load(anchorPreload);
    fireEvent.load(anchorPreload);

    expect(onNaturalSize).toHaveBeenCalledTimes(1);
    expect(onNaturalSize).toHaveBeenCalledWith({
      width: 1172,
      height: 1472,
    });
  });

  test("uses a stable portrait ratio when dimensions are unavailable", () => {
    expect(portraitFootprintWidth(100, 1920, 1080)).toBe(42.1875);
    expect(
      portraitFootprintWidth(100, 1920, 1080, {
        width: 1172,
        height: 1472,
      }),
    ).toBeCloseTo(44.79, 2);
  });

  test("uses the next loaded frame when the anchor frame fails", async () => {
    vi.mocked(fetchApiBlob).mockRejectedValueOnce(new Error("missing frame"));
    const onNaturalSize = vi.fn();
    const rendered = render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
        onNaturalSize={onNaturalSize}
      />,
    );
    await settleFrames();

    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
    const nextFramePreload = rendered.container.querySelector<HTMLImageElement>(
      '.galgame-expression-frame-preload[data-file-id="file-1"]',
    );
    if (!nextFramePreload) throw new Error("missing fallback preload");
    Object.defineProperties(nextFramePreload, {
      naturalWidth: { configurable: true, value: 900 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    fireEvent.load(nextFramePreload);

    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
    expect(onNaturalSize).toHaveBeenCalledWith({ width: 900, height: 1200 });
  });

  test("uses a controlled frame without starting timed playback", async () => {
    render(
      <ExpressionPortrait
        expression={{
          ...expression(),
          sequence: {
            ...expression().sequence!,
            playbackMode: "lipSync",
          },
        }}
        assets={assets}
        controlledFrameIndex={1}
        alt="语音口型"
        fallback={<span>加载中</span>}
      />,
    );
    await settleFrames();
    expect(screen.getByAltText("语音口型")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByAltText("语音口型")).toHaveAttribute(
      "data-file-id",
      "file-1",
    );
  });

  test("keeps the previous loaded frame when the next frame fails", async () => {
    render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        alt="待机"
        fallback={<span>加载中</span>}
      />,
    );
    await settleFrames();
    fireEvent.load(screen.getByAltText("待机"));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.error(screen.getByAltText("待机"));
    expect(screen.getByAltText("待机")).toHaveAttribute(
      "data-file-id",
      "file-0",
    );
  });

  test("uses a skin override as a static portrait", async () => {
    render(
      <ExpressionPortrait
        expression={expression()}
        assets={assets}
        skinAssetId="asset-2"
        alt="皮肤立绘"
        fallback={<span>加载中</span>}
      />,
    );
    await settleFrames();
    expect(fetchApiBlob).toHaveBeenCalledTimes(1);
    expect(fetchApiBlob).toHaveBeenCalledWith("/v1/files/file-2/content");
  });
});
