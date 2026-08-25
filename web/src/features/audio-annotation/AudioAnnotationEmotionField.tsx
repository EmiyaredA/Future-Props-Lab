import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { EMOTION_PRESETS } from "./emotions";

export function AudioAnnotationEmotionField({
  emotion,
  onChange,
}: {
  emotion?: string | null;
  onChange: (emotion: string | null) => void;
}) {
  const isCustom = Boolean(
    emotion && !EMOTION_PRESETS.some((preset) => preset.value === emotion),
  );
  const [customValue, setCustomValue] = useState(isCustom ? emotion! : "");
  const applyCustomEmotion = () => {
    const next = customValue.trim();
    if (next) onChange(next);
  };

  return (
    <div className="annotation-inspector-field annotation-emotion-field">
      <span>
        情绪
        <small>预设或自定义</small>
      </span>
      <div
        className="annotation-emotion-options"
        role="group"
        aria-label="选择片段情绪"
      >
        <button
          type="button"
          className={emotion ? "" : "selected"}
          aria-pressed={!emotion}
          onClick={() => onChange(null)}
        >
          未标注
          {!emotion ? <Check aria-hidden /> : null}
        </button>
        {EMOTION_PRESETS.map((preset) => {
          const selected = emotion === preset.value;
          return (
            <button
              type="button"
              key={preset.value}
              className={selected ? `selected ${preset.tone}` : preset.tone}
              aria-pressed={selected}
              onClick={() => onChange(preset.value)}
            >
              <i aria-hidden />
              {preset.value}
              {selected ? <Check aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <form
        className={`annotation-emotion-custom${isCustom ? " selected" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomEmotion();
        }}
      >
        <input
          value={customValue}
          maxLength={40}
          aria-label="自定义情绪"
          placeholder="输入自定义情绪，如：克制的兴奋"
          onChange={(event) => setCustomValue(event.target.value)}
        />
        <button
          type="submit"
          disabled={!customValue.trim() || customValue.trim() === emotion}
        >
          {isCustom ? <Check aria-hidden /> : <Plus aria-hidden />}
          {isCustom ? "已使用" : "使用"}
        </button>
      </form>
    </div>
  );
}
