import { useEffect, useRef, useState } from "react";
import {
  Application,
  AlphaMask,
  Container,
  Mesh,
  MeshGeometry,
  Texture,
  Assets,
} from "pixi.js";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { Minus, Plus, Scan, Hand, LocateFixed } from "lucide-react";
import type { Asset, CharacterDocument, Deformer, Mode, Point } from "./types";
import { deformerTransform, type PosedPart } from "./model";
function AssetBridge({
  asset,
  onUrl,
}: {
  asset: Asset;
  onUrl: (id: string, url: string | null) => void;
}) {
  const { url } = useApiBlobUrl(asset.url);
  useEffect(() => {
    onUrl(asset.id, url);
    return () => {
      onUrl(asset.id, null);
      if (url) void Assets.unload(url).catch(() => {});
    };
  }, [asset.id, url, onUrl]);
  return null;
}
export function CharacterCanvas({
  doc,
  parts,
  deformers,
  assets,
  selected,
  mode,
  readOnly,
  onSelect,
  onPoint,
  onAddPoint,
  onGesture,
  urls,
  onUrl,
}: {
  doc: CharacterDocument;
  parts: PosedPart[];
  deformers: Deformer[];
  assets: Asset[];
  selected: string;
  mode: Mode;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onPoint: (index: number, point: Point) => void;
  onAddPoint: (point: Point) => void;
  onGesture: () => void;
  urls: Record<string, string>;
  onUrl: (id: string, url: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    appRef = useRef<Application | null>(null),
    svgRef = useRef<SVGSVGElement>(null);
  const [ready, setReady] = useState(0),
    [zoom, setZoom] = useState(1),
    [failure, setFailure] = useState("");
  const drag = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef(true);
  const [hand, setHand] = useState(false);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const fit = () => {
    const el = scrollRef.current;
    if (!el) return;
    fitRef.current = true;
    setZoom(
      Math.max(
        0.02,
        Math.min(
          (el.clientWidth - 48) / doc.width,
          (el.clientHeight - 80) / doc.height,
        ),
      ),
    );
    el.scrollTo(0, 0);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const resize = new ResizeObserver(() => {
      if (!fitRef.current) return;
      setZoom(
        Math.max(
          0.02,
          Math.min(
            (el.clientWidth - 48) / doc.width,
            (el.clientHeight - 80) / doc.height,
          ),
        ),
      );
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, [doc.width, doc.height]);
  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const app = new Application();
    app
      .init({
        backgroundAlpha: 0,
        antialias: true,
        width: doc.width,
        height: doc.height,
        preference: "webgl",
      })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        el.appendChild(app.canvas);
        appRef.current = app;
        setReady((v) => v + 1);
      })
      .catch(() => setFailure("无法创建 WebGL 画布，请检查图形加速设置"));
    return () => {
      disposed = true;
      appRef.current = null;
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, [doc.width, doc.height]);
  useEffect(() => {
    if (!ready || !appRef.current) return;
    const app = appRef.current;
    let stale = false;
    void (async () => {
      const textures = new Map<string, Texture>();
      for (const [key, url] of Object.entries(urls))
        textures.set(
          key,
          await Assets.load<Texture>({ src: url, parser: "texture" }),
        );
      if (stale) return;
      app.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
      const container = new Container();
      const make = (
        part: PosedPart,
        visible: boolean,
        visited = new Set<string>(),
      ): Mesh | null => {
        const texture = textures.get(part.assetId);
        if (!texture || visited.has(part.id)) return null;
        visited.add(part.id);
        const mesh = new Mesh({
          geometry: new MeshGeometry({
            positions: new Float32Array(
              part.worldVertices.flatMap((p) => [p.x, p.y]),
            ),
            uvs: new Float32Array(part.uvs.flatMap((p) => [p.x, p.y])),
            indices: new Uint32Array(part.triangles),
          }),
          texture,
        });
        mesh.alpha = part.opacity;
        mesh.visible = visible;
        if (part.maskId) {
          const maskPart = parts.find((p) => p.id === part.maskId);
          const mask = maskPart && make(maskPart, true, visited);
          if (mask) {
            container.addChild(mask);
            mesh.addEffect(new AlphaMask({ mask }));
            mesh.setMask({ channel: "alpha", inverse: false });
          }
        }
        return mesh;
      };
      for (const part of parts) {
        const mesh = make(part, part.visible);
        if (mesh) container.addChild(mesh);
      }
      app.stage.addChild(container);
    })().catch((e) => {
      if (!stale) setFailure(e instanceof Error ? e.message : "素材显示失败");
    });
    return () => {
      stale = true;
    };
  }, [ready, parts, urls]);
  const part = parts.find((p) => p.id === selected),
    deformer = deformers.find((d) => d.id === selected);
  const pointer = (event: React.PointerEvent | React.MouseEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * doc.width,
      y: ((event.clientY - rect.top) / rect.height) * doc.height,
    };
  };
  const editable =
    !hand && !readOnly && (mode === "model" || mode === "rig") && !part?.locked;
  const transform = deformerTransform(deformers);
  const warpPoints =
    deformer?.kind === "warp"
      ? deformer.points.map((p) => transform(p, deformer.parentId))
      : [];
  const pivot = deformer
    ? transform({ x: deformer.x, y: deformer.y }, deformer.parentId)
    : { x: 0, y: 0 };
  const controls = part?.worldVertices ?? warpPoints;
  return (
    <section className="l2-canvas-area">
      <div className="l2-canvas-tools">
        <button
          aria-label="缩小"
          onClick={() => {
            fitRef.current = false;
            setZoom((z) => Math.max(0.02, z / 1.25));
          }}
        >
          <Minus size={15} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="放大"
          onClick={() => {
            fitRef.current = false;
            setZoom((z) => Math.min(4, z * 1.25));
          }}
        >
          <Plus size={15} />
        </button>
        <button onClick={fit}>
          <Scan size={14} />
          适应窗口
        </button>
        <button
          aria-label="平移画布"
          aria-pressed={hand}
          onClick={() => setHand((v) => !v)}
        >
          <Hand size={14} />
        </button>
        <button
          disabled={!part && !deformer}
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            const points =
              part?.worldVertices ?? (warpPoints.length ? warpPoints : [pivot]);
            const x =
              (Math.min(...points.map((p) => p.x)) +
                Math.max(...points.map((p) => p.x))) /
              2;
            const y =
              (Math.min(...points.map((p) => p.y)) +
                Math.max(...points.map((p) => p.y))) /
              2;
            fitRef.current = false;
            const next = Math.max(zoom, 1);
            setZoom(next);
            requestAnimationFrame(() =>
              el.scrollTo({
                left: x * next + 24 - el.clientWidth / 2,
                top: y * next + 55 - el.clientHeight / 2,
              }),
            );
          }}
        >
          <LocateFixed size={14} />
          定位选中对象
        </button>
      </div>
      {assets.map((a) => (
        <AssetBridge key={a.id} asset={a} onUrl={onUrl} />
      ))}
      <div
        className="l2-canvas-scroll"
        ref={scrollRef}
        style={{ cursor: hand ? "grab" : undefined }}
        onPointerDownCapture={(e) => {
          if (!hand && e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          const el = e.currentTarget;
          pan.current = {
            x: e.clientX,
            y: e.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
          };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pan.current) return;
          e.currentTarget.scrollLeft =
            pan.current.left + pan.current.x - e.clientX;
          e.currentTarget.scrollTop =
            pan.current.top + pan.current.y - e.clientY;
        }}
        onPointerUp={(e) => {
          pan.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        <div
          className="l2-canvas-sheet"
          style={{
            width: doc.width * zoom,
            height: doc.height * zoom,
            minWidth: doc.width * zoom,
            minHeight: doc.height * zoom,
          }}
        >
          <div ref={host} className="l2-pixi" />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${doc.width} ${doc.height}`}
            className="l2-canvas-overlay"
            onDoubleClick={(e) => {
              if (editable && part && mode === "model") onAddPoint(pointer(e));
            }}
            onPointerMove={(e) => {
              if (drag.current !== null) onPoint(drag.current, pointer(e));
            }}
            onPointerUp={(e) => {
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            {parts
              .filter((p) => p.visible)
              .map((p) => (
                <path
                  key={p.id}
                  d={Array.from(
                    { length: p.triangles.length / 3 },
                    (_, i) =>
                      "M" +
                      p.triangles
                        .slice(i * 3, i * 3 + 3)
                        .map(
                          (n) =>
                            `${p.worldVertices[n].x},${p.worldVertices[n].y}`,
                        )
                        .join("L") +
                      "Z",
                  ).join(" ")}
                  fill="transparent"
                  stroke="none"
                  onPointerDown={(e) => {
                    if (!hand && e.target === e.currentTarget) onSelect(p.id);
                  }}
                />
              ))}
            {part && (mode === "model" || mode === "rig") && (
              <g
                fill="none"
                stroke="#b09cff"
                strokeWidth={1.3}
                vectorEffect="non-scaling-stroke"
              >
                {Array.from({ length: part.triangles.length / 3 }, (_, i) => (
                  <polygon
                    key={i}
                    vectorEffect="non-scaling-stroke"
                    points={part.triangles
                      .slice(i * 3, i * 3 + 3)
                      .map(
                        (n) =>
                          `${part.worldVertices[n].x},${part.worldVertices[n].y}`,
                      )
                      .join(" ")}
                  />
                ))}
              </g>
            )}
            {deformer?.kind === "warp" && (
              <g stroke="#a68aff" fill="none">
                {Array.from({ length: deformer.rows + 1 }, (_, row) => (
                  <polyline
                    key={`r${row}`}
                    vectorEffect="non-scaling-stroke"
                    points={warpPoints
                      .slice(
                        row * (deformer.columns + 1),
                        (row + 1) * (deformer.columns + 1),
                      )
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                  />
                ))}
                {Array.from({ length: deformer.columns + 1 }, (_, col) => (
                  <polyline
                    key={`c${col}`}
                    vectorEffect="non-scaling-stroke"
                    points={Array.from(
                      { length: deformer.rows + 1 },
                      (_, row) =>
                        warpPoints[row * (deformer.columns + 1) + col],
                    )
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                  />
                ))}
              </g>
            )}
            {editable &&
              controls.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={Math.max(doc.width / 170, 3)}
                  className="l2-vertex"
                  tabIndex={0}
                  aria-label={`顶点 ${index + 1}`}
                  onKeyDown={(e) => {
                    const delta = e.shiftKey ? 10 : 1;
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      onGesture();
                      onPoint(index, {
                        x:
                          point.x +
                          (e.key === "ArrowLeft"
                            ? -delta
                            : e.key === "ArrowRight"
                              ? delta
                              : 0),
                        y:
                          point.y +
                          (e.key === "ArrowUp"
                            ? -delta
                            : e.key === "ArrowDown"
                              ? delta
                              : 0),
                      });
                    }
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onGesture();
                    drag.current = index;
                    svgRef.current?.setPointerCapture(e.pointerId);
                  }}
                />
              ))}
            {deformer?.kind === "rotation" && (
              <g
                transform={`translate(${pivot.x} ${pivot.y})`}
                stroke="#ae94ff"
                fill="none"
                strokeWidth={2}
              >
                <circle r={doc.width / 12} />
                <path d="M-20 0H20M0 -20V20" />
              </g>
            )}
          </svg>
          {!doc.parts.length && (
            <div className="l2-canvas-empty">
              <img src="/brand/live2d-workshop-mark.png" alt="" />
              <h2>让角色动起来</h2>
              <p>
                导入分层 PSD 或透明 PNG
                <br />
                从网格与参数关键形开始制作
              </p>
            </div>
          )}
        </div>
      </div>
      {failure && (
        <p className="l2-error" role="alert">
          {failure}
        </p>
      )}
      <footer className="l2-canvas-status">
        <span>
          {doc.width} × {doc.height} · 透明画布
        </span>
        <span>
          {mode === "model"
            ? "拖动顶点 · 双击网格添加点"
            : mode === "rig"
              ? "编辑当前参数关键形"
              : "表情与动作共同驱动参数"}
        </span>
      </footer>
    </section>
  );
}
