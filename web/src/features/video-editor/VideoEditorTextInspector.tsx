import { useEffect, useRef, useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import {
  defaultTextStyle,
  textPosition,
  textPositionOperations,
} from "./textModel";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import "./video-editor-text.css";

type Draft = {
  text: string;
  fontSize: number;
  textColor: string;
  textMaxWidth: number;
  textStyle: NonNullable<VideoEditorClip["textStyle"]>;
};
const draftFor = (clip: VideoEditorClip): Draft => ({
  text: clip.text ?? "",
  fontSize: clip.fontSize,
  textColor: clip.textColor,
  textMaxWidth: clip.textMaxWidth ?? 1600,
  textStyle: {
    ...defaultTextStyle,
    align: clip.textStyle ? "center" : "left",
    ...clip.textStyle,
  },
});

export function VideoEditorTextInspector({
  clip,
  disabled = false,
  playheadUs,
  commit,
}: {
  clip: VideoEditorClip;
  disabled?: boolean;
  playheadUs: number;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFor(clip));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const focusPending = useRef(true);
  useEffect(() => {
    if (!disabled && focusPending.current) {
      input.current?.focus();
      focusPending.current = false;
    }
  }, [disabled]);
  useEffect(() => {
    if (!dirty) setDraft(draftFor(clip));
  }, [clip, dirty]);
  const edit = (patch: Partial<Draft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const save = async (next = draft) => {
    if (inFlight.current || (!dirty && next === draft)) return;
    if (!next.text.trim()) {
      setError("文字内容不能为空");
      return;
    }
    if (
      !Number.isInteger(next.fontSize) ||
      next.fontSize < 8 ||
      next.fontSize > 400 ||
      !Number.isInteger(next.textMaxWidth) ||
      next.textMaxWidth < 80 ||
      next.textMaxWidth > 1920 ||
      !Number.isInteger(next.textStyle.strokeWidth) ||
      next.textStyle.strokeWidth! < 0 ||
      next.textStyle.strokeWidth! > 20 ||
      !Number.isFinite(next.textStyle.backgroundOpacity) ||
      next.textStyle.backgroundOpacity! < 0 ||
      next.textStyle.backgroundOpacity! > 1
    ) {
      setError(
        "请检查字号（8–400）、宽度（80–1920）、描边（0–20）和背景透明度",
      );
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await commit(
        [
          {
            type: "updateClip",
            clipId: clip.id,
            patch: { ...next, fitMode: "native" },
          },
        ],
        [
          {
            type: "updateClip",
            clipId: clip.id,
            patch: {
              fitMode: clip.fitMode,
              text: clip.text,
              fontSize: clip.fontSize,
              textColor: clip.textColor,
              textMaxWidth: clip.textMaxWidth ?? null,
              textStyle: clip.textStyle ?? null,
            },
          },
        ],
      );
      setDirty(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存失败，草稿已保留",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const style = (patch: Partial<Draft["textStyle"]>, immediate = false) => {
    const next = { ...draft, textStyle: { ...draft.textStyle, ...patch } };
    edit(next);
    if (immediate) void save(next);
  };
  const position = textPosition(clip, playheadUs);
  const move = async (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const operations = textPositionOperations(clip, playheadUs, x, y);
    try {
      await commit(operations.redo, operations.undo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "位置保存失败");
    }
  };
  return (
    <section className="ve-inspector-section ve-text-editor">
      <div className="ve-section-heading">
        <div>
          <h3>文字与样式</h3>
          <p>固定中文字体 · 与导出一致</p>
        </div>
      </div>
      <fieldset disabled={pending} className="ve-text-fields">
        <label className="ve-stacked-field">
          <span>文字内容</span>
          <textarea
            ref={input}
            aria-label="文字内容"
            value={draft.text}
            maxLength={4000}
            rows={3}
            onChange={(event) => edit({ text: event.target.value })}
            onBlur={() => void save()}
          />
        </label>
        <div className="ve-field-grid">
          <label className="ve-stacked-field">
            <span>字号</span>
            <input
              type="number"
              min={8}
              max={400}
              value={draft.fontSize}
              onChange={(event) =>
                edit({ fontSize: Number(event.target.value) })
              }
              onBlur={() => void save()}
            />
          </label>
          <label className="ve-stacked-field">
            <span>最大宽度</span>
            <input
              type="number"
              min={80}
              max={1920}
              value={draft.textMaxWidth}
              onChange={(event) =>
                edit({ textMaxWidth: Number(event.target.value) })
              }
              onBlur={() => void save()}
            />
          </label>
        </div>
        <div className="ve-text-color">
          <span>文字颜色</span>
          <CustomColorPicker
            ariaLabel="文字颜色"
            value={draft.textColor}
            onChange={(textColor) => {
              const next = { ...draft, textColor };
              edit(next);
              void save(next);
            }}
          />
        </div>
        <div className="ve-text-color">
          <span>描边颜色</span>
          <CustomColorPicker
            ariaLabel="描边颜色"
            value={draft.textStyle.strokeColor!}
            onChange={(strokeColor) => style({ strokeColor }, true)}
          />
        </div>
        <label className="ve-stacked-field">
          <span>描边宽度</span>
          <input
            type="number"
            min={0}
            max={20}
            value={draft.textStyle.strokeWidth}
            onChange={(event) =>
              style({ strokeWidth: Number(event.target.value) })
            }
            onBlur={() => void save()}
          />
        </label>
        <div className="ve-text-color">
          <span>文字背景</span>
          <button
            type="button"
            role="switch"
            aria-label="文字背景"
            aria-checked={Boolean(draft.textStyle.backgroundOpacity)}
            onClick={() =>
              style(
                {
                  backgroundOpacity: draft.textStyle.backgroundOpacity
                    ? 0
                    : 0.6,
                },
                true,
              )
            }
          >
            {draft.textStyle.backgroundOpacity ? "已开启" : "已关闭"}
          </button>
        </div>
        {!!draft.textStyle.backgroundOpacity && (
          <>
            <CustomColorPicker
              ariaLabel="背景颜色"
              value={draft.textStyle.backgroundColor!}
              onChange={(backgroundColor) => style({ backgroundColor }, true)}
            />
            <label className="ve-stacked-field">
              <span>背景不透明度</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.textStyle.backgroundOpacity}
                onChange={(event) =>
                  style({ backgroundOpacity: Number(event.target.value) })
                }
                onBlur={() => void save()}
              />
            </label>
          </>
        )}
        <div
          className="ve-text-button-group"
          role="group"
          aria-label="文字对齐"
        >
          {(
            [
              ["left", "左对齐"],
              ["center", "居中对齐"],
              ["right", "右对齐"],
            ] as const
          ).map(([align, label]) => (
            <button
              key={align}
              type="button"
              aria-pressed={draft.textStyle.align === align}
              onClick={() => style({ align }, true)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="ve-text-error">
            {error}
            <button type="button" onClick={() => void save()}>
              重试保存
            </button>
          </div>
        )}
      </fieldset>
      <h3>文字位置</h3>
      <div
        className="ve-text-button-group"
        role="group"
        aria-label="文字快捷位置"
      >
        {(
          [
            ["底部", 1000],
            ["居中", 540],
            ["顶部", 160],
          ] as const
        ).map(([label, y]) => (
          <button type="button" key={label} onClick={() => void move(960, y)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ve-field-grid">
        {(["x", "y"] as const).map((axis) => (
          <label key={axis} className="ve-stacked-field">
            <span>文字 {axis.toUpperCase()}</span>
            <input
              type="number"
              key={`${axis}-${position[axis]}`}
              defaultValue={position[axis]}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (value !== position[axis])
                  void move(
                    axis === "x" ? value : position.x,
                    axis === "y" ? value : position.y,
                  );
              }}
            />
          </label>
        ))}
      </div>
      <small>在预览中拖动文字，Esc 取消；方向键微调，Shift 加速。</small>
    </section>
  );
}
