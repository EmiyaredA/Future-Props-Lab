import { Check, Plus, Smile } from "lucide-react";
import { useState } from "react";
import { AnnotationCollapsedSelect } from "./AnnotationCollapsedSelect";
import {
  EMOTION_PRESETS,
  MAX_CUSTOM_EMOTIONS,
  emotionDuplicateWarning,
  emotionKey,
  isPresetEmotion,
  mergeCustomEmotion,
} from "./emotions";
import {
  applySpeakerEmotions,
  type SpeakerEmotionEntry,
} from "./model";
import type { AudioAnnotationSpeaker } from "./types";

export function AudioAnnotationEmotionField({
  speakers,
  speakerEmotions,
  speakerIds,
  customEmotions,
  onChange,
  onManage,
}: {
  speakers: AudioAnnotationSpeaker[];
  speakerEmotions: SpeakerEmotionEntry[];
  speakerIds: string[];
  customEmotions: string[];
  onChange: (next: {
    speaker_emotions: SpeakerEmotionEntry[];
    emotion: string | null;
    custom_emotions?: string[];
  }) => void;
  onManage: () => void;
}) {
  const boundSpeakers = speakers.filter((speaker) =>
    speakerIds.includes(speaker.id),
  );
  const [targetIds, setTargetIds] = useState<string[]>(() =>
    boundSpeakers.map((speaker) => speaker.id),
  );
  const activeTargets = targetIds.filter((id) => speakerIds.includes(id));
  const targetEmotions = speakerEmotions.filter((item) =>
    activeTargets.includes(item.speaker_id),
  );
  const sharedEmotion =
    activeTargets.length &&
    targetEmotions.length === activeTargets.length &&
    new Set(targetEmotions.map((item) => item.emotion)).size === 1
      ? targetEmotions[0]!.emotion
      : null;
  const isCustom = Boolean(
    sharedEmotion && !isPresetEmotion(sharedEmotion),
  );
  const [customValue, setCustomValue] = useState(
    isCustom && sharedEmotion ? sharedEmotion : "",
  );
  const [vocabNotice, setVocabNotice] = useState("");
  const allSelected =
    boundSpeakers.length > 0 &&
    boundSpeakers.every((speaker) => activeTargets.includes(speaker.id));
  const canEdit = activeTargets.length > 0;

  const applyEmotion = (
    emotion: string | null,
    nextCustomEmotions?: string[],
  ) => {
    if (!canEdit) return;
    onChange({
      ...applySpeakerEmotions(
        {
          speaker_id: speakerIds[0] ?? null,
          speaker_ids: speakerIds,
          emotion: sharedEmotion,
          speaker_emotions: speakerEmotions,
        },
        activeTargets,
        emotion,
      ),
      ...(nextCustomEmotions ? { custom_emotions: nextCustomEmotions } : {}),
    });
  };

  const presets = EMOTION_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.value,
    tone: preset.tone,
  }));
  const customOptions = customEmotions.map((emotion) => ({
    value: emotion,
    label: emotion,
    tone: "custom",
  }));
  const knownKeys = new Set([
    ...presets.map((item) => emotionKey(item.value)),
    ...customEmotions.map((item) => emotionKey(item)),
  ]);
  const options = [
    { value: "", label: "未标注" },
    ...presets,
    ...customOptions,
    ...(sharedEmotion && !knownKeys.has(emotionKey(sharedEmotion))
      ? [{ value: sharedEmotion, label: sharedEmotion, tone: "custom" }]
      : []),
  ];

  return (
    <div className="annotation-inspector-field annotation-emotion-field">
      <span>
        情绪
        <small>绑定说话人后标注</small>
      </span>
      {boundSpeakers.length ? (
        <div
          className="annotation-emotion-targets"
          role="group"
          aria-label="选择情绪绑定的说话人"
        >
          <button
            type="button"
            className={allSelected ? "selected" : ""}
            aria-pressed={allSelected}
            onClick={() =>
              setTargetIds(
                allSelected ? [] : boundSpeakers.map((speaker) => speaker.id),
              )
            }
          >
            全选
          </button>
          {boundSpeakers.map((speaker) => {
            const checked = activeTargets.includes(speaker.id);
            return (
              <button
                type="button"
                key={speaker.id}
                className={checked ? "selected" : ""}
                aria-pressed={checked}
                onClick={() =>
                  setTargetIds((current) =>
                    checked
                      ? current.filter((id) => id !== speaker.id)
                      : [...current, speaker.id],
                  )
                }
              >
                <i style={{ background: speaker.color }} aria-hidden />
                <span>{speaker.name}</span>
                {checked ? <Check aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="annotation-emotion-empty">
          请先为片段选择说话人，再标注情绪。
        </p>
      )}
      <AnnotationCollapsedSelect
        ariaLabel="选择片段情绪"
        emptyLabel={
          activeTargets.length && targetEmotions.length
            ? "多种情绪"
            : "未标注"
        }
        options={options}
        value={sharedEmotion ?? ""}
        triggerLabel={
          !canEdit
            ? "先选择绑定说话人"
            : sharedEmotion
              ? undefined
              : activeTargets.length && targetEmotions.length
                ? "多种情绪"
                : "未标注"
        }
        onChange={(emotion) => {
          setVocabNotice("");
          applyEmotion(emotion);
          if (emotion && !isPresetEmotion(emotion)) setCustomValue(emotion);
        }}
        trailing={
          <button
            type="button"
            className="annotation-speaker-manage"
            onClick={onManage}
          >
            <Smile aria-hidden /> 管理
          </button>
        }
      />
      <form
        className={`annotation-emotion-custom${isCustom ? " selected" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          const next = customValue.trim();
          if (!next || !canEdit) return;
          const merged = mergeCustomEmotion(customEmotions, next);
          if (merged.duplicateOf) {
            applyEmotion(next);
            setVocabNotice(
              emotionDuplicateWarning(merged.duplicateOf, merged.label!),
            );
            return;
          }
          if (merged.added) {
            applyEmotion(next, merged.emotions);
            setVocabNotice("");
            return;
          }
          applyEmotion(next);
          if (merged.label) {
            setVocabNotice(`自定义情绪最多 ${MAX_CUSTOM_EMOTIONS} 个`);
          }
        }}
      >
        <input
          value={customValue}
          maxLength={40}
          aria-label="自定义情绪"
          placeholder="输入自定义情绪，如：克制的兴奋"
          disabled={!canEdit}
          onChange={(event) => {
            setCustomValue(event.target.value);
            if (vocabNotice) setVocabNotice("");
          }}
        />
        <button
          type="submit"
          disabled={
            !canEdit ||
            !customValue.trim() ||
            customValue.trim() === sharedEmotion
          }
        >
          {isCustom &&
          sharedEmotion &&
          emotionKey(sharedEmotion) === emotionKey(customValue) ? (
            <Check aria-hidden />
          ) : (
            <Plus aria-hidden />
          )}
          {isCustom &&
          sharedEmotion &&
          emotionKey(sharedEmotion) === emotionKey(customValue)
            ? "已使用"
            : "使用"}
        </button>
      </form>
      {vocabNotice ? (
        <p
          className="annotation-emotion-vocab-notice"
          role="status"
          aria-label="情绪词库提示"
        >
          {vocabNotice}
        </p>
      ) : null}
    </div>
  );
}
