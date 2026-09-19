import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import "./video-editor-chroma.css";

type ChromaKey = Required<NonNullable<VideoEditorClip["chromaKey"]>>;

const defaultChromaKey: ChromaKey = {
  enabled: false,
  color: "#00ff00",
  similarity: 42,
  softness: 18,
  despill: 30,
};

export function VideoEditorChromaInspector({
  clip,
  commit,
}: {
  clip: VideoEditorClip;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const colorInput = useRef<HTMLInputElement>(null);
  const lastSubmitted = useRef("");
  const [draft, setDraft] = useState<ChromaKey>({
    ...defaultChromaKey,
    ...clip.chromaKey,
  });
  useEffect(() => {
    setDraft({ ...defaultChromaKey, ...clip.chromaKey });
    lastSubmitted.current = "";
  }, [clip.id, clip.chromaKey]);
  const save = (next: ChromaKey) => {
    setDraft(next);
    const signature = JSON.stringify(next);
    if (
      signature ===
        JSON.stringify({ ...defaultChromaKey, ...clip.chromaKey }) ||
      signature === lastSubmitted.current
    )
      return;
    lastSubmitted.current = signature;
    void commit(
      [{ type: "updateClip", clipId: clip.id, patch: { chromaKey: next } }],
      [
        {
          type: "updateClip",
          clipId: clip.id,
          patch: { chromaKey: clip.chromaKey ?? null },
        },
      ],
    ).catch(() => {
      lastSubmitted.current = "";
      setDraft({ ...defaultChromaKey, ...clip.chromaKey });
    });
  };
  const chooseColor = async () => {
    const Picker = (
      window as Window & {
        EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
      }
    ).EyeDropper;
    if (!Picker) {
      colorInput.current?.click();
      return;
    }
    try {
      const result = await new Picker().open();
      save({ ...draft, color: result.sRGBHex });
    } catch {
      // Cancelling the system eyedropper leaves the clip unchanged.
    }
  };
  return (
    <section className="ve-inspector-section ve-chroma-section">
      <div className="ve-section-heading">
        <div>
          <h3>抠像</h3>
          <p>移除纯色背景，露出下层画面</p>
        </div>
      </div>
      <label className="ve-chroma-enable">
        <span>启用抠像</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) =>
            save({ ...draft, enabled: event.target.checked })
          }
        />
      </label>
      <div className="ve-chroma-controls" aria-disabled={!draft.enabled}>
        <span>抠像颜色</span>
        <div
          className="ve-chroma-presets"
          role="group"
          aria-label="抠像颜色预设"
        >
          {(
            [
              ["#00ff00", "绿色"],
              ["#0000ff", "蓝色"],
            ] as const
          ).map(([color, label]) => (
            <button
              key={color}
              type="button"
              aria-pressed={draft.color.toLowerCase() === color}
              onClick={() => save({ ...draft, color })}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="选择自定义抠像颜色"
            onClick={() => colorInput.current?.click()}
          >
            自定义
          </button>
        </div>
        <div className="ve-chroma-color-row">
          <button
            type="button"
            className="ve-chroma-swatch"
            style={{ background: draft.color }}
            aria-label="选择抠像颜色"
            onClick={() => colorInput.current?.click()}
          />
          <input
            ref={colorInput}
            hidden
            type="color"
            aria-label="自定义抠像颜色"
            value={draft.color}
            onChange={(event) => save({ ...draft, color: event.target.value })}
          />
          <button type="button" onClick={() => void chooseColor()}>
            <Pipette aria-hidden /> 吸取颜色
          </button>
        </div>
        {(
          [
            ["similarity", "相似度"],
            ["softness", "边缘柔化"],
            ["despill", "溢色抑制"],
          ] as const
        ).map(([name, label]) => (
          <label className="ve-chroma-slider" key={name}>
            <span>{label}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={draft[name]}
              aria-label={label}
              onChange={(event) =>
                setDraft({ ...draft, [name]: Number(event.target.value) })
              }
              onPointerUp={(event) =>
                save({ ...draft, [name]: Number(event.currentTarget.value) })
              }
              onKeyUp={(event) =>
                save({ ...draft, [name]: Number(event.currentTarget.value) })
              }
              onBlur={(event) =>
                save({ ...draft, [name]: Number(event.currentTarget.value) })
              }
            />
            <output>{Math.round(draft[name])}</output>
          </label>
        ))}
        <button
          type="button"
          className="ve-chroma-reset"
          onClick={() => save({ ...defaultChromaKey, enabled: draft.enabled })}
        >
          重置参数
        </button>
      </div>
    </section>
  );
}
