import { Plus, Smile, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  EMOTION_PRESETS,
  MAX_CUSTOM_EMOTIONS,
  MAX_EMOTION_LENGTH,
  emotionDuplicateWarning,
  emotionKey,
  mergeCustomEmotion,
  normalizeEmotionLabel,
} from "@features/audio-annotation/emotions";

export function AudioAnnotationEmotionManager({
  open,
  customEmotions,
  onChange,
  onRename,
  onClose,
}: {
  open: boolean;
  customEmotions: string[];
  onChange: (emotions: string[]) => void;
  onRename: (from: string, to: string) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Record<number, string>>({});

  if (!open) return null;

  const add = () => {
    const result = mergeCustomEmotion(customEmotions, draft);
    if (!result.label) {
      setNotice("请输入 1 到 40 个字符的情绪名称");
      return;
    }
    if (result.duplicateOf) {
      setNotice(emotionDuplicateWarning(result.duplicateOf, result.label));
      return;
    }
    if (!result.added) {
      setNotice(`自定义情绪最多 ${MAX_CUSTOM_EMOTIONS} 个`);
      return;
    }
    onChange(result.emotions);
    setDraft("");
    setNotice("");
  };

  const commitRename = (index: number, current: string) => {
    const typed = editing[index];
    setEditing((state) => {
      const next = { ...state };
      delete next[index];
      return next;
    });
    if (typed === undefined) return;
    const next = normalizeEmotionLabel(typed);
    if (!next) {
      setNotice("请输入 1 到 40 个字符的情绪名称");
      return;
    }
    if (emotionKey(next) === emotionKey(current)) {
      if (next !== current) onRename(current, next);
      setNotice("");
      return;
    }
    const conflict = mergeCustomEmotion(
      customEmotions.filter((item) => emotionKey(item) !== emotionKey(current)),
      next,
    );
    if (conflict.duplicateOf) {
      setNotice(emotionDuplicateWarning(conflict.duplicateOf, next));
      return;
    }
    if (!onRename(current, next)) {
      setNotice(`「${next}」无法更新`);
      return;
    }
    setNotice("");
  };

  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal annotation-speaker-modal annotation-emotion-modal"
        role="dialog"
        aria-modal="true"
        aria-label="管理情绪词库"
      >
        <header>
          <div>
            <span className="eyebrow">任务内词库</span>
            <h2>管理情绪</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <section className="annotation-emotion-presets">
          <div>
            <strong>内置预设</strong>
            <small>只读，可在片段中直接选用。</small>
          </div>
          <div
            className="annotation-emotion-preset-chips"
            aria-label="内置情绪预设"
          >
            {EMOTION_PRESETS.map((preset) => (
              <span key={preset.value} data-tone={preset.tone}>
                {preset.value}
              </span>
            ))}
          </div>
        </section>
        <div className="annotation-speaker-list annotation-emotion-list">
          {customEmotions.map((emotion, index) => (
            <div key={`${emotionKey(emotion)}-${index}`}>
              <span className="annotation-emotion-list-mark" aria-hidden>
                <Smile />
              </span>
              <input
                aria-label={`自定义情绪 ${index + 1}`}
                value={editing[index] ?? emotion}
                maxLength={MAX_EMOTION_LENGTH}
                onChange={(event) =>
                  setEditing((state) => ({
                    ...state,
                    [index]: event.target.value,
                  }))
                }
                onBlur={() => commitRename(index, emotion)}
              />
              <button
                type="button"
                aria-label={`删除情绪${emotion}`}
                onClick={() => {
                  onChange(
                    customEmotions.filter(
                      (item) => emotionKey(item) !== emotionKey(emotion),
                    ),
                  );
                  setNotice("");
                }}
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
          {!customEmotions.length ? (
            <p>还没有自定义情绪。添加后会出现在片段下拉里。</p>
          ) : null}
        </div>
        <form
          className="annotation-emotion-manager-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            maxLength={MAX_EMOTION_LENGTH}
            aria-label="新增自定义情绪"
            placeholder="输入自定义情绪，如：克制的兴奋"
            onChange={(event) => {
              setDraft(event.target.value);
              if (notice) setNotice("");
            }}
          />
          <button
            type="submit"
            className="btn"
            disabled={
              !draft.trim() || customEmotions.length >= MAX_CUSTOM_EMOTIONS
            }
          >
            <Plus aria-hidden /> 添加
          </button>
        </form>
        {notice ? (
          <p className="annotation-emotion-manager-notice" role="status">
            {notice}
          </p>
        ) : null}
        <footer>
          <button type="button" className="btn primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
