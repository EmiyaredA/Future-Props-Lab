import { CustomSelect } from "@shared/ui/CustomSelect";
import type { SpeechLimits } from "./useSpeechDraft";
import { speechCloningLabels as labels } from "./speechSynthesisPresentation";

export function ZonosSpeechControls({
  limits,
  draft,
  disabled,
}: {
  limits: SpeechLimits;
  draft: {
    cloneMode: string;
    setCloneMode: (value: string) => void;
    emotion: string;
    setEmotion: (value: string) => void;
    emotionStrength: number;
    setEmotionStrength: (value: number) => void;
    seed: string;
    setSeed: (value: string) => void;
  };
  disabled: boolean;
}) {
  return (
    <section className="speech-reference" aria-label="克隆与情绪设置">
      <h2>克隆与情绪</h2>
      <label>克隆模式</label>
      <CustomSelect
        ariaLabel="克隆模式"
        value={draft.cloneMode}
        options={(limits.clone_modes ?? []).map((value) => ({
          value,
          label: labels[value] ?? value,
        }))}
        onChange={draft.setCloneMode}
        disabled={disabled}
      />
      <p className="speech-help">
        提取音色适合调整表达；原始参考音频保留更多原录音的说话方式。两种模式均无需录音对应文字。
      </p>
      <label>情绪</label>
      <CustomSelect
        ariaLabel="情绪"
        value={draft.emotion}
        options={(limits.emotions ?? []).map((value) => ({
          value,
          label: labels[value] ?? value,
        }))}
        onChange={draft.setEmotion}
        disabled={disabled}
      />
      <label>
        情绪强度 · {Math.round(draft.emotionStrength * 100)}%
        <input
          aria-label="情绪强度"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={draft.emotionStrength}
          onChange={(event) =>
            draft.setEmotionStrength(Number(event.target.value))
          }
          disabled={disabled || draft.emotion === "neutral"}
        />
      </label>
      <p className="speech-help">
        强度越高越可能改变音色；“不施加情绪”保留模型根据录音和文稿生成的表达。
      </p>
      {limits.supports_seed && (
        <label>
          随机种子
          <input
            aria-label="随机种子"
            type="number"
            min="0"
            max="4294967295"
            step="1"
            value={draft.seed}
            onChange={(event) => draft.setSeed(event.target.value)}
            disabled={disabled}
          />
        </label>
      )}
    </section>
  );
}
