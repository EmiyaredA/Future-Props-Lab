import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useEffect, useRef, useState } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  VideoSource,
} from "pixi.js";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { maskPath, pointsAt, valueAt } from "./model";
import type { MotionAsset, MotionLayer, ResolvedDocument } from "./types";

function AssetUrlBridge({
  asset,
  onUrl,
}: {
  asset: MotionAsset;
  onUrl: (id: string, url: string) => void;
}) {
  const { url } = useApiBlobUrl(asset.url);
  useEffect(() => {
    onUrl(asset.id, url);
  }, [asset.id, url, onUrl]);
  return null;
}

function drawShape(layer: MotionLayer): Graphics {
  const graphic = new Graphics();
  const w = layer.width,
    h = layer.height;
  if (layer.shape === "ellipse")
    graphic.ellipse(0, 0, w / 2, h / 2).fill(layer.fill);
  else if (layer.shape === "triangle")
    graphic.poly([-w / 2, h / 2, 0, -h / 2, w / 2, h / 2]).fill(layer.fill);
  else if (layer.shape === "speedLines") {
    for (let index = 0; index < 12; index++) {
      const y = (index * h) / 12 - h / 2;
      const x = ((index * 47) % Math.max(1, w / 3)) - w / 2;
      graphic
        .moveTo(x, y)
        .lineTo(w / 2, y - 28)
        .stroke({ color: layer.fill, width: 3 + (index % 4) });
    }
  } else graphic.rect(-w / 2, -h / 2, w, h).fill(layer.fill);
  return graphic;
}

function drawMask(layer: MotionLayer, frame: number): Graphics | null {
  if (!layer.mask) return null;
  const points = pointsAt(layer.mask, frame - layer.startFrame);
  if (!points.length) return null;
  const mask = new Graphics();
  mask.moveTo(points[0].x - layer.width / 2, points[0].y - layer.height / 2);
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length];
    mask.bezierCurveTo(
      a.x + a.outX - layer.width / 2,
      a.y + a.outY - layer.height / 2,
      b.x + b.inX - layer.width / 2,
      b.y + b.inY - layer.height / 2,
      b.x - layer.width / 2,
      b.y - layer.height / 2,
    );
  }
  mask.closePath().fill(0xffffff);
  return mask;
}

export function MotionCanvas({
  projectId,
  document,
  assets,
  frame,
  selectedId,
  precise,
  savedRevision,
  onSelect,
  onMove,
  onDragStart,
  onMaskPoint,
}: {
  projectId: string;
  document: ResolvedDocument;
  assets: MotionAsset[];
  frame: number;
  selectedId: string | null;
  precise: boolean;
  savedRevision: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDragStart: () => void;
  onMaskPoint: (index: number, x: number, y: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const videos = useRef(
    new Map<
      string,
      { url: string; element: HTMLVideoElement; texture?: Texture }
    >(),
  );
  const [ready, setReady] = useState(false);
  const [videoReadyTick, setVideoReadyTick] = useState(0);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const precisePath = precise
    ? `/v1/motion-compositor/projects/${encodeURIComponent(projectId)}/preview/frame?frame=${frame}&revision=${savedRevision}`
    : null;
  const { url: preciseUrl } = useApiBlobUrl(precisePath);
  const drag = useRef<{ id: string; offsetX: number; offsetY: number } | null>(
    null,
  );
  const draggingPoint = useRef<number | null>(null);
  const onUrl = (id: string, url: string) =>
    setUrls((previous) =>
      previous[id] === url ? previous : { ...previous, [id]: url },
    );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const videoSources = videos.current;
    let disposed = false;
    const app = new Application();
    void app
      .init({ resizeTo: element, backgroundAlpha: 0, antialias: true })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        element.appendChild(app.canvas);
        appRef.current = app;
        setReady(true);
      });
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => {
      disposed = true;
      observer.disconnect();
      appRef.current = null;
      for (const source of videoSources.values()) {
        source.element.pause();
        source.texture?.destroy();
      }
      videoSources.clear();
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!ready || !app) return;
    let disposed = false;
    const old = app.stage.removeChildren();
    old.forEach((child) => child.destroy({ children: true }));
    const scale = Math.min(
      size.width / document.settings.width,
      size.height / document.settings.height,
    );
    const root = new Container();
    root.scale.set(scale);
    root.position.set(
      (size.width - document.settings.width * scale) / 2,
      (size.height - document.settings.height * scale) / 2,
    );
    app.stage.addChild(root);
    const media = new Map(assets.map((asset) => [asset.id, asset]));
    for (const layer of document.layers) {
      if (!layer.visible || frame < layer.startFrame || frame >= layer.endFrame)
        continue;
      const wrapper = new Container();
      wrapper.position.set(
        valueAt(layer, "x", frame),
        valueAt(layer, "y", frame),
      );
      wrapper.scale.set(
        valueAt(layer, "scaleX", frame),
        valueAt(layer, "scaleY", frame),
      );
      wrapper.rotation = (valueAt(layer, "rotation", frame) * Math.PI) / 180;
      wrapper.alpha = valueAt(layer, "opacity", frame);
      wrapper.eventMode = "static";
      wrapper.cursor = "move";
      wrapper.on("pointerdown", (event) => {
        onSelect(layer.id);
        onDragStart();
        const x = (event.global.x - root.x) / scale;
        const y = (event.global.y - root.y) / scale;
        drag.current = {
          id: layer.id,
          offsetX: x - valueAt(layer, "x", frame),
          offsetY: y - valueAt(layer, "y", frame),
        };
      });
      const content = new Container();
      wrapper.addChild(content);
      root.addChild(wrapper);
      if (layer.kind === "shape") content.addChild(drawShape(layer));
      if (layer.kind === "text") {
        const label = new Text({
          text: layer.text,
          style: {
            fontFamily: "Noto Sans SC, sans-serif",
            fontSize: layer.fontSize,
            fontWeight: "900",
            fill: layer.fill,
            stroke: { color: layer.stroke, width: layer.effects?.outline ?? 0 },
          },
        });
        label.anchor.set(0.5);
        content.addChild(label);
      }
      if (
        (layer.kind === "image" || layer.kind === "video") &&
        layer.assetId &&
        media.has(layer.assetId)
      ) {
        const url = urls[layer.assetId];
        if (url) {
          if (layer.kind === "image") {
            void Assets.load<Texture>(url)
              .then((texture) => {
                if (disposed || wrapper.destroyed) return;
                const sprite = new Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.width = layer.width;
                sprite.height = layer.height;
                content.addChild(sprite);
              })
              .catch(() => undefined);
          } else {
            let source = videos.current.get(layer.assetId);
            if (source && source.url !== url) {
              source.element.pause();
              source.texture?.destroy();
              videos.current.delete(layer.assetId);
              source = undefined;
            }
            if (!source) {
              const element = window.document.createElement("video");
              element.src = url;
              element.muted = true;
              element.playsInline = true;
              element.preload = "auto";
              element.addEventListener(
                "loadeddata",
                () => setVideoReadyTick((tick) => tick + 1),
                { once: true },
              );
              source = { url, element };
              videos.current.set(layer.assetId, source);
              element.load();
            }
            const time =
              layer.sourceStartUs / 1_000_000 +
              (frame - layer.startFrame) / document.settings.fps;
            if (
              Math.abs(source.element.currentTime - time) >
              1 / (document.settings.fps * 2)
            )
              source.element.currentTime = time;
            if (source.element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
              continue;
            if (!source.texture)
              source.texture = new Texture({
                source: new VideoSource({
                  resource: source.element,
                  autoPlay: false,
                }),
              });
            const sprite = new Sprite(source.texture);
            sprite.anchor.set(0.5);
            sprite.width = layer.width;
            sprite.height = layer.height;
            content.addChild(sprite);
          }
        }
      }
      const mask = drawMask(layer, frame);
      if (mask) {
        wrapper.addChild(mask);
        content.mask = mask;
      }
    }
    return () => {
      disposed = true;
    };
  }, [
    ready,
    document,
    assets,
    urls,
    frame,
    size,
    onSelect,
    onDragStart,
    videoReadyTick,
  ]);

  useEffect(() => {
    const canvas = appRef.current?.canvas;
    if (!canvas) return;
    const move = (event: PointerEvent) => {
      if (!drag.current || !host.current) return;
      const rect = host.current.getBoundingClientRect();
      const scale = Math.min(
        rect.width / document.settings.width,
        rect.height / document.settings.height,
      );
      const left = (rect.width - document.settings.width * scale) / 2;
      const top = (rect.height - document.settings.height * scale) / 2;
      const x =
        (event.clientX - rect.left - left) / scale - drag.current.offsetX;
      const y = (event.clientY - rect.top - top) / scale - drag.current.offsetY;
      onMove(drag.current.id, Math.round(x), Math.round(y));
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [ready, document.settings, onMove]);

  const selected = document.layers.find((layer) => layer.id === selectedId);
  const x = selected ? valueAt(selected, "x", frame) : 0;
  const y = selected ? valueAt(selected, "y", frame) : 0;
  const sx = selected ? valueAt(selected, "scaleX", frame) : 1;
  const sy = selected ? valueAt(selected, "scaleY", frame) : 1;
  const rotation = selected ? valueAt(selected, "rotation", frame) : 0;
  return (
    <div className="mc-canvas-viewport">
      {assets.map((asset) => (
        <AssetUrlBridge key={asset.id} asset={asset} onUrl={onUrl} />
      ))}
      <div
        ref={host}
        className="mc-pixi-host"
        onClick={(event) => {
          if (event.target === host.current) onSelect(null);
        }}
      />
      {precise && preciseUrl && (
        <ResponsiveImage
          className="mc-precise-frame"
          src={preciseUrl}
          alt={`第 ${frame} 帧精确画面`}
        />
      )}
      {selected && (
        <svg
          className="mc-selection-overlay"
          viewBox={`0 0 ${document.settings.width} ${document.settings.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="图层位置和遮罩控制点"
        >
          <g
            transform={`translate(${x} ${y}) rotate(${rotation}) scale(${sx} ${sy})`}
          >
            <rect
              x={-selected.width / 2}
              y={-selected.height / 2}
              width={selected.width}
              height={selected.height}
              fill="none"
              stroke="#5daaff"
              strokeWidth={2 / Math.max(sx, sy)}
            />
            {selected.mask && (
              <path
                d={maskPath(
                  pointsAt(selected.mask, frame - selected.startFrame),
                  selected.width,
                  selected.height,
                )}
                fill="none"
                stroke="#73b7ff"
                strokeWidth="3"
                strokeDasharray="12 8"
              />
            )}
            {selected.mask &&
              pointsAt(selected.mask, frame - selected.startFrame).map(
                (point, index) => (
                  <circle
                    key={index}
                    cx={point.x - selected.width / 2}
                    cy={point.y - selected.height / 2}
                    r={8 / Math.max(sx, sy)}
                    fill="#f3f6ff"
                    stroke="#267ce3"
                    strokeWidth={3 / Math.max(sx, sy)}
                    style={{ pointerEvents: "all", cursor: "grab" }}
                    aria-label={`遮罩控制点 ${index + 1}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      draggingPoint.current = index;
                      onDragStart();
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (draggingPoint.current !== index) return;
                      const matrix = (
                        event.currentTarget
                          .parentElement as unknown as SVGGElement | null
                      )
                        ?.getScreenCTM()
                        ?.inverse();
                      if (!matrix) return;
                      const position = new DOMPoint(
                        event.clientX,
                        event.clientY,
                      ).matrixTransform(matrix);
                      onMaskPoint(
                        index,
                        Math.round(position.x + selected.width / 2),
                        Math.round(position.y + selected.height / 2),
                      );
                    }}
                    onPointerUp={() => {
                      draggingPoint.current = null;
                    }}
                  />
                ),
              )}
          </g>
        </svg>
      )}
    </div>
  );
}
