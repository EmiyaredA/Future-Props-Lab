import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import "./video-editor-chroma.css";

type ChromaKey = Required<NonNullable<VideoEditorClip["chromaKey"]>>;

const PRESET_COLORS = ["#00ff00", "#0000ff"] as const;

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
  const lastSubmitted = useRef("");
  const [colorOpen, setColorOpen] = useState(false);
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
      setColorOpen(true);
      return;
    }
    try {
      const result = await new Picker().open();
      save({ ...draft, color: result.sRGBHex });
    } catch {
      // Cancelling the system eyedropper leaves the clip unchanged.
    }
  };
  const color = draft.color.toLowerCase();
  const isCustom = !PRESET_COLORS.includes(
    color as (typeof PRESET_COLORS)[number],
  );
  return (
    <section className="ve-inspector-section ve-chroma-section">
      <div className="ve-section-heading">
        <div>
          <h3>抠像</h3>
          <p>移除纯色背景，露出下层画面</p>
        </div>
        <label className="ve-chroma-enable">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              save({ ...draft, enabled: event.target.checked })
            }
          />
          <span>启用</span>
        </label>
      </div>
      <div
        className={`ve-chroma-controls${draft.enabled ? "" : " is-disabled"}`}
        aria-disabled={!draft.enabled}
      >
        <div className="ve-chroma-color-row">
          <div
            className="ve-chroma-presets"
            role="group"
            aria-label="抠像颜色预设"
          >
            {(
              [
                ["#00ff00", "绿"],
                ["#0000ff", "蓝"],
              ] as const
            ).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                aria-pressed={color === preset}
                disabled={!draft.enabled}
                onClick={() => save({ ...draft, color: preset })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-label="选择自定义抠像颜色"
              aria-pressed={isCustom || colorOpen}
              disabled={!draft.enabled}
              onClick={() => setColorOpen(true)}
            >
              自定义
            </button>
          </div>
          <CustomColorPicker
            compact
            placement="center"
            open={colorOpen}
            onOpenChange={setColorOpen}
            ariaLabel="自定义抠像颜色"
            value={draft.color}
            disabled={!draft.enabled}
            onChange={(next) => save({ ...draft, color: next })}
          />
          <button
            type="button"
            className="ve-chroma-pick"
            disabled={!draft.enabled}
            title="吸取颜色"
            aria-label="吸取抠像颜色"
            onClick={() => void chooseColor()}
          >
            <Pipette aria-hidden />
          </button>
        </div>
        {(
          [
            ["similarity", "相似度"],
            ["softness", "柔化"],
            ["despill", "溢色"],
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
              disabled={!draft.enabled}
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
          disabled={!draft.enabled}
          onClick={() => save({ ...defaultChromaKey, enabled: draft.enabled })}
        >
          重置
        </button>
      </div>
    </section>
  );
}
