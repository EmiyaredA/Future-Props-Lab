import { useEffect, useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import {
  CHROMA_COLOR_PRESETS,
  type ChromaKey,
  NAMED_CHROMA_PRESETS,
  defaultChromaKey,
  type NamedChromaPresetId,
} from "./chromaPresets";
import "./video-editor-chroma.css";
import "./video-editor-assets.css";

export function VideoEditorAssetDefaultChromaDialog({
  open,
  count,
  pending,
  onCancel,
  onApply,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onCancel: () => void;
  onApply: (chromaKey: ChromaKey | null) => void;
}) {
  const [draft, setDraft] = useState<ChromaKey>({
    ...defaultChromaKey,
    enabled: true,
  });
  const [namedId, setNamedId] = useState<NamedChromaPresetId | undefined>();
  const [colorOpen, setColorOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft({ ...defaultChromaKey, enabled: true });
    setNamedId(undefined);
    setColorOpen(false);
  }, [open]);
  if (!open) return null;
  const color = draft.color.toLowerCase();
  const isCustom = !CHROMA_COLOR_PRESETS.includes(
    color as (typeof CHROMA_COLOR_PRESETS)[number],
  );
  return (
    <div className="ve-asset-chroma-dialog" role="dialog" aria-modal="true">
      <div className="ve-asset-chroma-dialog-card">
        <header>
          <strong>默认抠像</strong>
          <p>将应用到 {count} 个视频/图片素材；之后上轨自动带入参数。</p>
        </header>
        <label className="ve-chroma-enable">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={pending}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          <span>启用抠像</span>
        </label>
        <div
          className="ve-batch-mode-options"
          role="group"
          aria-label="抠像参数预设"
        >
          {NAMED_CHROMA_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              disabled={pending}
              aria-pressed={namedId === preset.id}
              onClick={() => {
                setNamedId(preset.id);
                setDraft({ ...preset.values });
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div
          className={`ve-chroma-controls${draft.enabled ? "" : " is-disabled"}`}
        >
          <div className="ve-chroma-color-row">
            <div className="ve-chroma-presets" role="group" aria-label="颜色">
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
                  disabled={pending || !draft.enabled}
                  onClick={() => {
                    setNamedId(undefined);
                    setDraft((current) => ({ ...current, color: preset }));
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={isCustom || colorOpen}
                disabled={pending || !draft.enabled}
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
              ariaLabel="默认抠像颜色"
              value={draft.color}
              disabled={pending || !draft.enabled}
              onChange={(next) => {
                setNamedId(undefined);
                setDraft((current) => ({ ...current, color: next }));
              }}
            />
          </div>
          {(
            [
              ["similarity", "相似度"],
              ["softness", "柔化"],
              ["despill", "溢色"],
            ] as const
          ).map(([field, label]) => (
            <label className="ve-chroma-slider" key={field}>
              <span>{label}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={draft[field]}
                disabled={pending || !draft.enabled}
                aria-label={label}
                onChange={(event) => {
                  setNamedId(undefined);
                  setDraft((current) => ({
                    ...current,
                    [field]: Number(event.target.value),
                  }));
                }}
              />
              <output>{Math.round(draft[field])}</output>
            </label>
          ))}
        </div>
        <footer>
          <button type="button" disabled={pending} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onApply(null)}
          >
            清除默认
          </button>
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() => onApply(draft)}
          >
            应用到选中
          </button>
        </footer>
      </div>
    </div>
  );
}
