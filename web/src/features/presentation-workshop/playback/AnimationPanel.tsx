import { CustomSelect } from "@shared/ui/CustomSelect";
import { NumberField } from "../PresentationNumberField";
import { newId } from "../templates";
import type { Slide } from "../types";
import { effectLabels, effects, type SlideAnimation } from "./animationModel";

export function AnimationPanel({
  slide,
  selected,
  readOnly,
  change,
}: {
  slide: Slide;
  selected: string[];
  readOnly: boolean;
  change: (slide: Slide) => void;
}) {
  const animations = slide.animations ?? [];
  const patch = (id: string, value: Partial<SlideAnimation>) =>
    change({
      ...slide,
      animations: animations.map((a) => (a.id === id ? { ...a, ...value } : a)),
    });
  const transition = slide.transition ?? {
    effect: "none",
    duration: 600,
    advance_after: null,
  };
  return (
    <section aria-label="动画与切换" className="presentation-animation-panel">
      <fieldset disabled={readOnly}>
        <legend>页面切换</legend>
        <CustomSelect
          ariaLabel="翻页效果"
          value={transition.effect}
          options={[
            "none",
            "fade",
            "slideX",
            "slideY",
            "slideX3D",
            "slideY3D",
            "rotate",
            "scaleX",
            "scaleY",
            "scale",
            "scaleReverse",
            "random",
          ].map((value, i) => ({
            value,
            label: [
              "无",
              "淡入",
              "水平滑动",
              "垂直滑动",
              "水平立体",
              "垂直立体",
              "旋转",
              "水平展开",
              "垂直展开",
              "放大",
              "缩小",
              "随机",
            ][i],
          }))}
          onChange={(effect) =>
            change({
              ...slide,
              transition: {
                ...transition,
                effect: effect as typeof transition.effect,
              },
            })
          }
        />
        <NumberField
          label="切换时长（毫秒）"
          value={transition.duration}
          min={50}
          max={10000}
          step={50}
          onChange={(duration) =>
            change({
              ...slide,
              transition: { ...transition, duration: Math.round(duration) },
            })
          }
        />
        <button
          className="btn"
          aria-pressed={transition.advance_after !== null}
          onClick={() =>
            change({
              ...slide,
              transition: {
                ...transition,
                advance_after: transition.advance_after === null ? 5 : null,
              },
            })
          }
        >
          自动翻页
        </button>
        {transition.advance_after !== null && (
          <NumberField
            label="自动翻页间隔（秒）"
            value={transition.advance_after ?? 5}
            min={1}
            max={3600}
            onChange={(advance_after) =>
              change({ ...slide, transition: { ...transition, advance_after } })
            }
          />
        )}
      </fieldset>
      <button
        className="btn"
        disabled={
          readOnly ||
          !selected.length ||
          animations.length + selected.length > 600
        }
        onClick={() =>
          change({
            ...slide,
            animations: [
              ...animations,
              ...selected
                .filter((id) =>
                  slide.elements.some(
                    (e) => e.id === id && !e.locked && !e.hidden,
                  ),
                )
                .map((element_id) => ({
                  id: newId(),
                  element_id,
                  type: "in" as const,
                  effect: "fade" as const,
                  direction: "none" as const,
                  trigger: "click" as const,
                  duration: 800,
                  delay: 0,
                })),
            ],
          })
        }
      >
        为所选元素添加动画
      </button>
      {animations.map((animation, index) => (
        <fieldset key={animation.id} disabled={readOnly}>
          <legend>
            {index + 1}.{" "}
            {slide.elements.find((e) => e.id === animation.element_id)?.name ||
              "元素动画"}
          </legend>
          <CustomSelect
            ariaLabel={`动画 ${index + 1} 类型`}
            value={animation.type}
            options={[
              { value: "in", label: "入场" },
              { value: "out", label: "退场" },
              { value: "emphasis", label: "强调" },
            ]}
            onChange={(type) =>
              patch(animation.id, { type: type as SlideAnimation["type"] })
            }
          />
          <CustomSelect
            ariaLabel={`动画 ${index + 1} 效果`}
            value={animation.effect}
            options={effects.map((value, i) => ({
              value,
              label: effectLabels[i],
            }))}
            onChange={(effect) =>
              patch(animation.id, {
                effect: effect as SlideAnimation["effect"],
              })
            }
          />
          <CustomSelect
            ariaLabel={`动画 ${index + 1} 方向`}
            value={animation.direction}
            options={["none", "left", "right", "top", "bottom"].map(
              (value, i) => ({
                value,
                label: ["默认", "从左", "从右", "从上", "从下"][i],
              }),
            )}
            onChange={(direction) =>
              patch(animation.id, {
                direction: direction as SlideAnimation["direction"],
              })
            }
          />
          <CustomSelect
            ariaLabel={`动画 ${index + 1} 触发`}
            value={animation.trigger}
            options={[
              { value: "click", label: "单击时" },
              { value: "with_previous", label: "与上一动画同时" },
              { value: "after_previous", label: "上一动画之后" },
            ]}
            onChange={(trigger) =>
              patch(animation.id, {
                trigger: trigger as SlideAnimation["trigger"],
              })
            }
          />
          <NumberField
            label={`动画 ${index + 1} 时长`}
            value={animation.duration}
            min={50}
            max={10000}
            step={50}
            onChange={(duration) =>
              patch(animation.id, { duration: Math.round(duration) })
            }
          />
          <NumberField
            label={`动画 ${index + 1} 延迟`}
            value={animation.delay}
            min={0}
            max={30000}
            step={50}
            onChange={(delay) =>
              patch(animation.id, { delay: Math.round(delay) })
            }
          />
          <div className="presentation-object-actions">
            <button
              className="btn"
              disabled={index === 0}
              onClick={() => {
                const next = [...animations];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                change({ ...slide, animations: next });
              }}
            >
              上移
            </button>
            <button
              className="btn"
              onClick={() =>
                change({
                  ...slide,
                  animations: animations.filter((a) => a.id !== animation.id),
                })
              }
            >
              删除动画
            </button>
          </div>
        </fieldset>
      ))}
    </section>
  );
}
