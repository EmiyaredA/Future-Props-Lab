import {
  ArrowDown,
  ArrowUp,
  Diamond,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { defaultMask, pointsAt, valueAt } from "./model";
import type { MotionKeyframe, MotionLayer } from "./types";

const TRANSFORMS = [
  ["x", "位置 X"],
  ["y", "位置 Y"],
  ["scaleX", "缩放 X"],
  ["scaleY", "缩放 Y"],
  ["rotation", "旋转"],
  ["opacity", "不透明度"],
] as const;

export function MotionInspector({
  layer,
  frame,
  onPatch,
  onTransform,
  onAddKeyframe,
  onRemoveKeyframe,
  onMaskPoint,
  onRemove,
  onMoveLayer,
}: {
  layer: MotionLayer | null;
  frame: number;
  onPatch: (patch: Partial<MotionLayer>) => void;
  onTransform: (key: MotionKeyframe["property"], value: number) => void;
  onAddKeyframe: (key: MotionKeyframe["property"]) => void;
  onRemoveKeyframe: (key: MotionKeyframe["property"]) => void;
  onMaskPoint: (index: number, x: number, y: number) => void;
  onRemove: () => void;
  onMoveLayer: (step: number) => void;
}) {
  if (!layer)
    return (
      <aside className="mc-inspector">
        <div className="mc-inspector-empty">
          <Diamond size={28} />
          <strong>选择一个图层</strong>
          <span>在画布或时间线中选择图层，即可调整属性。</span>
        </div>
      </aside>
    );
  const mask = layer.mask;
  const points = mask ? pointsAt(mask, frame - layer.startFrame) : [];
  const setEffect = (
    key: "outline" | "shadow" | "halftone" | "duotone",
    value: number | boolean,
  ) =>
    onPatch({
      effects: {
        outline: 0,
        shadow: 0,
        halftone: 0,
        duotone: false,
        ...layer.effects,
        [key]: value,
      },
    });
  return (
    <aside className="mc-inspector">
      <div className="mc-inspector-head">
        <span>属性检查器 · 已选中图层</span>
        <h2>{layer.name}</h2>
        <small>
          {layer.kind === "video"
            ? "视频"
            : layer.kind === "image"
              ? "图片"
              : layer.kind === "text"
                ? "文字"
                : "图形"}
          图层
        </small>
      </div>
      <div className="mc-inspector-scroll">
        <section className="mc-inspector-section">
          <h3>图层</h3>
          <label>
            名称
            <input
              value={layer.name}
              onChange={(event) => onPatch({ name: event.target.value })}
            />
          </label>
          <div className="mc-inline">
            <button onClick={() => onPatch({ visible: !layer.visible })}>
              {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}{" "}
              {layer.visible ? "显示中" : "已隐藏"}
            </button>
            <button onClick={() => onMoveLayer(1)} title="图层上移">
              <ArrowUp size={15} /> 上移
            </button>
            <button onClick={() => onMoveLayer(-1)} title="图层下移">
              <ArrowDown size={15} /> 下移
            </button>
            <button onClick={onRemove}>
              <Trash2 size={15} /> 删除
            </button>
          </div>
          <div className="mc-inspector-grid">
            <label>
              开始帧
              <input
                type="number"
                min={0}
                max={layer.endFrame - 1}
                value={layer.startFrame}
                onChange={(event) =>
                  onPatch({ startFrame: Number(event.target.value) })
                }
              />
            </label>
            <label>
              结束帧
              <input
                type="number"
                min={layer.startFrame + 1}
                value={layer.endFrame}
                onChange={(event) =>
                  onPatch({ endFrame: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </section>
        {(layer.kind === "shape" || layer.kind === "text") && (
          <section className="mc-inspector-section">
            <h3>{layer.kind === "text" ? "文字" : "图形"}</h3>
            {layer.kind === "text" ? (
              <>
                <label>
                  内容
                  <textarea
                    rows={3}
                    value={layer.text}
                    onChange={(event) => onPatch({ text: event.target.value })}
                  />
                </label>
                <label>
                  字号
                  <input
                    type="number"
                    min={8}
                    max={500}
                    value={layer.fontSize}
                    onChange={(event) =>
                      onPatch({ fontSize: Number(event.target.value) })
                    }
                  />
                </label>
              </>
            ) : (
              <div className="mc-shape-options">
                {(["rect", "ellipse", "triangle", "speedLines"] as const).map(
                  (shape) => (
                    <button
                      key={shape}
                      aria-pressed={layer.shape === shape}
                      onClick={() => onPatch({ shape })}
                    >
                      {
                        {
                          rect: "矩形",
                          ellipse: "椭圆",
                          triangle: "三角",
                          speedLines: "速度线",
                        }[shape]
                      }
                    </button>
                  ),
                )}
              </div>
            )}
            <label>
              填充色 HEX
              <input
                value={layer.fill}
                maxLength={7}
                onChange={(event) => onPatch({ fill: event.target.value })}
              />
            </label>
            <div className="mc-inspector-grid">
              <label>
                宽度
                <input
                  type="number"
                  min={1}
                  value={layer.width}
                  onChange={(event) =>
                    onPatch({ width: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                高度
                <input
                  type="number"
                  min={1}
                  value={layer.height}
                  onChange={(event) =>
                    onPatch({ height: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </section>
        )}
        {(layer.kind === "image" || layer.kind === "video") && (
          <section className="mc-inspector-section">
            <h3>媒体尺寸</h3>
            <div className="mc-inspector-grid">
              <label>
                宽度
                <input
                  type="number"
                  min={1}
                  value={layer.width}
                  onChange={(event) =>
                    onPatch({ width: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                高度
                <input
                  type="number"
                  min={1}
                  value={layer.height}
                  onChange={(event) =>
                    onPatch({ height: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            {layer.kind === "video" && (
              <label>
                素材起始时间（秒）
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={layer.sourceStartUs / 1_000_000}
                  onChange={(event) =>
                    onPatch({
                      sourceStartUs: Math.round(
                        Number(event.target.value) * 1_000_000,
                      ),
                    })
                  }
                />
              </label>
            )}
          </section>
        )}
        <section className="mc-inspector-section">
          <h3>变换与关键帧</h3>
          {TRANSFORMS.map(([key, label]) => (
            <div className="mc-property-field" key={key}>
              <label>
                {label}
                <input
                  type="number"
                  step={
                    key === "opacity" ? 0.05 : key.startsWith("scale") ? 0.1 : 1
                  }
                  value={Math.round(valueAt(layer, key, frame) * 1000) / 1000}
                  onChange={(event) =>
                    onTransform(key, Number(event.target.value))
                  }
                />
              </label>
              <button
                title={`在当前帧添加${label}关键帧`}
                aria-label={`为${label}添加关键帧`}
                onClick={() => onAddKeyframe(key)}
              >
                <Diamond
                  size={15}
                  fill={
                    (layer.keyframes ?? []).some(
                      (item) =>
                        item.property === key &&
                        item.frame === frame - layer.startFrame,
                    )
                      ? "currentColor"
                      : "none"
                  }
                />
              </button>
              <button
                title={`删除当前帧${label}关键帧`}
                aria-label={`删除${label}当前关键帧`}
                onClick={() => onRemoveKeyframe(key)}
              >
                −
              </button>
            </div>
          ))}
        </section>
        <section className="mc-inspector-section">
          <h3>路径遮罩</h3>
          <div className="mc-inline">
            <button
              onClick={() =>
                onPatch({ mask: mask ? null : defaultMask(layer) })
              }
            >
              {mask ? "关闭遮罩" : "+ 启用手动遮罩"}
            </button>
            {mask && (
              <button
                onClick={() => {
                  const keyframes = (mask.keyframes ?? []).filter(
                    (item) => item.frame !== frame - layer.startFrame,
                  );
                  keyframes.push({ frame: frame - layer.startFrame, points });
                  onPatch({ mask: { ...mask, keyframes } });
                }}
              >
                <Plus size={14} /> 当前帧路径
              </button>
            )}
          </div>
          {mask && (
            <>
              <label>
                边缘羽化（px）
                <input
                  type="number"
                  min={0}
                  max={32}
                  value={mask.feather}
                  onChange={(event) =>
                    onPatch({
                      mask: { ...mask, feather: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <button
                className="mc-check"
                aria-pressed={mask.inverted}
                onClick={() =>
                  onPatch({ mask: { ...mask, inverted: !mask.inverted } })
                }
              >
                反转遮罩 {mask.inverted ? "✓" : ""}
              </button>
              <div className="mc-mask-points">
                {points.map((point, index) => (
                  <div key={index}>
                    <span>点 {index + 1}</span>
                    <input
                      aria-label={`点${index + 1} X`}
                      type="number"
                      value={Math.round(point.x)}
                      onChange={(event) =>
                        onMaskPoint(index, Number(event.target.value), point.y)
                      }
                    />
                    <input
                      aria-label={`点${index + 1} Y`}
                      type="number"
                      value={Math.round(point.y)}
                      onChange={(event) =>
                        onMaskPoint(index, point.x, Number(event.target.value))
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="mc-inspector-section">
          <h3>风格效果</h3>
          <div className="mc-inspector-grid">
            <label>
              描边（px）
              <input
                type="number"
                min={0}
                max={30}
                value={layer.effects?.outline ?? 0}
                onChange={(event) =>
                  setEffect("outline", Number(event.target.value))
                }
              />
            </label>
            <label>
              投影（px）
              <input
                type="number"
                min={0}
                max={100}
                value={layer.effects?.shadow ?? 0}
                onChange={(event) =>
                  setEffect("shadow", Number(event.target.value))
                }
              />
            </label>
            <label>
              网点间距
              <input
                type="number"
                min={0}
                max={40}
                value={layer.effects?.halftone ?? 0}
                onChange={(event) =>
                  setEffect("halftone", Number(event.target.value))
                }
              />
            </label>
            <button
              className="mc-check"
              aria-pressed={layer.effects?.duotone ?? false}
              onClick={() =>
                setEffect("duotone", !(layer.effects?.duotone ?? false))
              }
            >
              红黑双色调 {layer.effects?.duotone ? "✓" : ""}
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
