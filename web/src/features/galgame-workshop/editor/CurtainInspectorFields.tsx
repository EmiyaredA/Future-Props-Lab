import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CURTAIN_MODE_OPTIONS } from "@features/galgame-workshop/editor/blockRegistry";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/InspectorFieldControls";
export function CurtainInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, patch } = model;
  if (!block || block.type !== "curtain" || !patch) return null;
  return (
    <div className="galgame-curtain-inspector">
      <section>
        <span>模式</span>
        <div
          className="galgame-inspector-segments is-four"
          role="group"
          aria-label="幕布模式"
        >
          {CURTAIN_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={block.mode === option.value ? "active" : ""}
              aria-pressed={block.mode === option.value}
              onClick={() =>
                patch((current) =>
                  current.type === "curtain"
                    ? { ...current, mode: option.value }
                    : current,
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <span>动作</span>
        <div
          className="galgame-inspector-segments"
          role="group"
          aria-label="幕布动作"
        >
          <button
            type="button"
            className={block.action === "show" ? "active" : ""}
            aria-pressed={block.action === "show"}
            onClick={() =>
              patch((current) =>
                current.type === "curtain"
                  ? { ...current, action: "show" }
                  : current,
              )
            }
          >
            合上（屏幕变暗）
          </button>
          <button
            type="button"
            className={block.action === "hide" ? "active" : ""}
            aria-pressed={block.action === "hide"}
            onClick={() =>
              patch((current) =>
                current.type === "curtain"
                  ? { ...current, action: "hide" }
                  : current,
              )
            }
          >
            打开（屏幕显露）
          </button>
        </div>
      </section>
      <label className="galgame-inspector-range-row">
        <span>时长</span>
        <div>
          <span>
            <input
              aria-label="幕布动画时长"
              type="number"
              min="0"
              max="60000"
              step="100"
              value={block.durationMs}
              onChange={(event) =>
                patch((current) =>
                  current.type === "curtain"
                    ? {
                        ...current,
                        durationMs: Math.min(
                          60000,
                          Math.max(0, Number(event.target.value)),
                        ),
                      }
                    : current,
                )
              }
            />
            <em>ms</em>
          </span>
          <input
            aria-label="幕布动画时长滑杆"
            type="range"
            min="0"
            max="60000"
            step="100"
            value={block.durationMs}
            onChange={(event) =>
              patch((current) =>
                current.type === "curtain"
                  ? { ...current, durationMs: Number(event.target.value) }
                  : current,
              )
            }
          />
        </div>
      </label>
      <label className="galgame-curtain-color-row">
        <span>颜色</span>
        <CustomColorPicker
          ariaLabel="幕布颜色"
          value={block.color}
          onChange={(color) =>
            patch((current) =>
              current.type === "curtain" ? { ...current, color } : current,
            )
          }
        />
      </label>
      <label className="galgame-inspector-range-row">
        <span>不透明度</span>
        <div>
          <output>{Math.round(block.opacity * 100)}%</output>
          <input
            aria-label="幕布不透明度"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={block.opacity}
            onChange={(event) =>
              patch((current) =>
                current.type === "curtain"
                  ? { ...current, opacity: Number(event.target.value) }
                  : current,
              )
            }
          />
        </div>
      </label>
      <label className="galgame-inspector-check-row">
        <input
          type="checkbox"
          checked={block.waitForCompletion}
          onChange={(event) =>
            patch((current) =>
              current.type === "curtain"
                ? {
                    ...current,
                    waitForCompletion: event.target.checked,
                  }
                : current,
            )
          }
        />
        <span>等待动画完成后继续</span>
      </label>
    </div>
  );
}
