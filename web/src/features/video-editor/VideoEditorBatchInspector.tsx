import { useEffect, useMemo, useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { VideoEditorClip } from "./types";
import {
  type BatchClipPatch,
  type BatchFitMode,
  type BatchPatchResult,
  type TransformField,
  type VolumeAdjustMode,
  clipSupportsChroma,
  clipSupportsFitMode,
  clipSupportsTransform,
  clipSupportsVolume,
  clipTransform,
  clampVolume,
  mixedValues,
} from "./batchClipPatch";
import {
  CHROMA_COLOR_PRESETS,
  type ChromaKey,
  type ChromaKeyField,
  type NamedChromaPresetId,
  NAMED_CHROMA_PRESETS,
  defaultChromaKey,
  resolveChromaKey,
} from "./chromaPresets";
import "./video-editor-inspector.css";
import "./video-editor-chroma.css";

type DirtyTransform = Partial<Record<TransformField, string>>;
type DirtyChroma = Partial<ChromaKey>;

function formatApplyMessage(result: BatchPatchResult) {
  const parts = [`已应用到 ${result.applied} 个片段`];
  if (result.skipped.length) {
    parts.push(
      `跳过 ${result.skipped.length} 个片段：${result.skipped
        .slice(0, 3)
        .map((item) => `“${item.name}”：${item.reason}`)
        .join("；")}${result.skipped.length > 3 ? "…" : ""}`,
    );
  }
  if (result.truncated) {
    parts.push("其余片段因单次操作上限未写入，请分批再试");
  }
  return parts.join("。");
}

export function VideoEditorBatchInspector({
  clips,
  disabled = false,
  applyPatch,
}: {
  clips: VideoEditorClip[];
  disabled?: boolean;
  applyPatch: (patch: BatchClipPatch) => Promise<BatchPatchResult>;
}) {
  const [volumeMode, setVolumeMode] = useState<VolumeAdjustMode>("set");
  const [volumeDraft, setVolumeDraft] = useState("");
  const [volumeDirty, setVolumeDirty] = useState(false);
  const [fitMode, setFitMode] = useState<BatchFitMode | undefined>();
  const [transformDraft, setTransformDraft] = useState<DirtyTransform>({});
  const [lockAspect, setLockAspect] = useState(true);
  const [chromaDraft, setChromaDraft] = useState<DirtyChroma>({});
  const [namedPresetId, setNamedPresetId] = useState<
    NamedChromaPresetId | undefined
  >();
  const [colorOpen, setColorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const selectionKey = clips.map((clip) => clip.id).join("\0");

  const volumeClips = useMemo(
    () => clips.filter(clipSupportsVolume),
    [clips],
  );
  const fitClips = useMemo(() => clips.filter(clipSupportsFitMode), [clips]);
  const transformClips = useMemo(
    () => clips.filter(clipSupportsTransform),
    [clips],
  );
  const chromaClips = useMemo(
    () => clips.filter(clipSupportsChroma),
    [clips],
  );

  const volumeMixed = mixedValues(volumeClips.map((clip) => clip.volume));
  const mutedMixed = mixedValues(
    volumeClips.map((clip) => Boolean(clip.muted)),
  );
  const fitMixed = mixedValues(
    fitClips.map((clip) => clip.fitMode as BatchFitMode | string),
  );
  const transformMixed = {
    x: mixedValues(transformClips.map((clip) => clipTransform(clip).x)),
    y: mixedValues(transformClips.map((clip) => clipTransform(clip).y)),
    scaleX: mixedValues(
      transformClips.map((clip) => clipTransform(clip).scaleX),
    ),
    scaleY: mixedValues(
      transformClips.map((clip) => clipTransform(clip).scaleY),
    ),
    rotation: mixedValues(
      transformClips.map((clip) => clipTransform(clip).rotation),
    ),
  };
  const chromaMixed = {
    enabled: mixedValues(
      chromaClips.map((clip) => resolveChromaKey(clip).enabled),
    ),
    color: mixedValues(
      chromaClips.map((clip) => resolveChromaKey(clip).color.toLowerCase()),
    ),
    similarity: mixedValues(
      chromaClips.map((clip) => resolveChromaKey(clip).similarity),
    ),
    softness: mixedValues(
      chromaClips.map((clip) => resolveChromaKey(clip).softness),
    ),
    despill: mixedValues(
      chromaClips.map((clip) => resolveChromaKey(clip).despill),
    ),
  };

  useEffect(() => {
    setVolumeMode("set");
    setVolumeDraft("");
    setVolumeDirty(false);
    setFitMode(undefined);
    setTransformDraft({});
    setChromaDraft({});
    setNamedPresetId(undefined);
    setColorOpen(false);
    setMessage("");
  }, [selectionKey]);

  const displayVolume = () => {
    if (volumeDirty) return volumeDraft;
    if (volumeMode === "delta") return "";
    if (volumeMode === "mute" || volumeMode === "unmute") return "";
    return volumeMixed.mixed ? "" : String(volumeMixed.value);
  };

  const transformDisplay = (field: TransformField) => {
    if (field in transformDraft) return transformDraft[field] ?? "";
    const mixed = transformMixed[field];
    return mixed.mixed ? "" : String(mixed.value);
  };

  const setTransformField = (field: TransformField, raw: string) => {
    setTransformDraft((current) => {
      const next = { ...current, [field]: raw };
      if (lockAspect && (field === "scaleX" || field === "scaleY")) {
        next.scaleX = raw;
        next.scaleY = raw;
      }
      return next;
    });
  };

  const parsedTransform = () => {
    const transform: Partial<Record<TransformField, number>> = {};
    for (const [field, raw] of Object.entries(transformDraft) as [
      TransformField,
      string,
    ][]) {
      if (raw.trim() === "" || Number.isNaN(Number(raw))) continue;
      transform[field] = Number(raw);
    }
    return transform;
  };

  const setChromaField = <K extends ChromaKeyField>(
    field: K,
    value: ChromaKey[K],
  ) => {
    setNamedPresetId(undefined);
    setChromaDraft((current) => ({ ...current, [field]: value }));
  };

  const applyNamedPreset = (id: NamedChromaPresetId) => {
    const preset = NAMED_CHROMA_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setNamedPresetId(id);
    setChromaDraft({ ...preset.values });
  };

  const chromaEnabled =
    "enabled" in chromaDraft
      ? Boolean(chromaDraft.enabled)
      : !chromaMixed.enabled.mixed && chromaMixed.enabled.value;

  const chromaColor =
    chromaDraft.color ??
    (!chromaMixed.color.mixed
      ? chromaMixed.color.value
      : defaultChromaKey.color);
  const colorLower = chromaColor.toLowerCase();
  const isCustomColor = !CHROMA_COLOR_PRESETS.includes(
    colorLower as (typeof CHROMA_COLOR_PRESETS)[number],
  );

  const chromaSliderValue = (field: "similarity" | "softness" | "despill") => {
    if (field in chromaDraft) return Number(chromaDraft[field]);
    const mixed = chromaMixed[field];
    return mixed.mixed ? defaultChromaKey[field] : mixed.value;
  };

  const buildPatch = (): BatchClipPatch | null => {
    const patch: BatchClipPatch = {};
    if (volumeMode === "mute" || volumeMode === "unmute") {
      if (volumeDirty) patch.audio = { mode: volumeMode };
    } else if (volumeDirty && volumeDraft !== "") {
      const numeric = Number(volumeDraft);
      if (!Number.isNaN(numeric)) {
        patch.audio =
          volumeMode === "set"
            ? { mode: "set", volume: clampVolume(numeric) }
            : { mode: "delta", delta: numeric };
      }
    }
    if (fitMode) {
      patch.visual = { ...patch.visual, fitMode };
    }
    const transform = parsedTransform();
    if (Object.keys(transform).length) {
      patch.visual = { ...patch.visual, transform };
    }
    if (Object.keys(chromaDraft).length) {
      patch.chroma = { ...chromaDraft };
    }
    if (!patch.audio && !patch.visual && !patch.chroma) return null;
    return patch;
  };

  const resetDrafts = () => {
    setVolumeDraft("");
    setVolumeDirty(false);
    setFitMode(undefined);
    setTransformDraft({});
    setChromaDraft({});
    setNamedPresetId(undefined);
    setColorOpen(false);
  };

  const apply = async () => {
    const patch = buildPatch();
    if (!patch) {
      setMessage("请先修改要批量应用的参数");
      return;
    }
    const result = await applyPatch(patch);
    resetDrafts();
    setMessage(formatApplyMessage(result));
  };

  const hasAudioSection = volumeClips.length > 0;
  const hasVisualSection = fitClips.length > 0 || transformClips.length > 0;
  const hasChromaSection = chromaClips.length > 0;
  const hasAnySection =
    hasAudioSection || hasVisualSection || hasChromaSection;

  return (
    <aside className="ve-inspector ve-batch-inspector">
      <header>
        <div>
          <strong>属性</strong>
          <small>已选择 {clips.length} 个片段</small>
        </div>
      </header>

      {hasAudioSection ? (
        <section className="ve-inspector-section">
          <div className="ve-section-heading">
            <div>
              <h3>音频</h3>
              <p>
                {volumeClips.length}/{clips.length} 个片段可调音量
                {mutedMixed.mixed
                  ? " · 静音状态混合"
                  : mutedMixed.value
                    ? " · 当前静音"
                    : ""}
              </p>
            </div>
          </div>
          <div
            className="ve-batch-mode-options"
            role="radiogroup"
            aria-label="音量调整方式"
          >
            {(
              [
                ["set", "设置为固定值"],
                ["delta", "增加 / 减少"],
                ["mute", "静音"],
                ["unmute", "取消静音"],
              ] as const
            ).map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                role="radio"
                aria-checked={volumeMode === mode}
                disabled={disabled}
                onClick={() => {
                  setVolumeMode(mode);
                  setVolumeDraft("");
                  setVolumeDirty(mode === "mute" || mode === "unmute");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {volumeMode === "set" || volumeMode === "delta" ? (
            <label className="ve-key-field">
              <span>{volumeMode === "set" ? "音量" : "增减量"}</span>
              <input
                type="number"
                min={volumeMode === "set" ? 0 : -4}
                max={4}
                step={0.05}
                disabled={disabled}
                placeholder={
                  volumeMode === "set" && volumeMixed.mixed ? "混合" : undefined
                }
                value={displayVolume()}
                onChange={(event) => {
                  setVolumeDraft(event.target.value);
                  setVolumeDirty(true);
                }}
              />
            </label>
          ) : null}
        </section>
      ) : null}

      {hasVisualSection ? (
        <section className="ve-inspector-section">
          <div className="ve-section-heading">
            <div>
              <h3>画面</h3>
              <p>只覆盖你改动的适配与变换字段</p>
            </div>
          </div>
          {fitClips.length ? (
            <>
              <p className="ve-batch-field-hint">
                画面适配（{fitClips.length}/{clips.length}）
                {fitMixed.mixed && !fitMode ? " · 混合" : ""}
              </p>
              <div
                className="ve-fit-mode-options"
                role="group"
                aria-label="批量画面适配"
              >
                {(
                  [
                    ["contain", "适应画布"],
                    ["cover", "填充画布"],
                    ["native", "原始尺寸"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    type="button"
                    key={mode}
                    disabled={disabled}
                    aria-pressed={fitMode === mode}
                    onClick={() =>
                      setFitMode((current) =>
                        current === mode ? undefined : mode,
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {transformClips.length ? (
            <>
              <label className="ve-batch-lock-aspect">
                <input
                  type="checkbox"
                  checked={lockAspect}
                  disabled={disabled}
                  onChange={(event) => setLockAspect(event.target.checked)}
                />
                保持宽高比
              </label>
              <div className="ve-property-grid">
                {(
                  [
                    ["x", "位置 X"],
                    ["y", "位置 Y"],
                    ["scaleX", "水平缩放"],
                    ["scaleY", "垂直缩放"],
                    ["rotation", "旋转"],
                  ] as const
                ).map(([field, label]) => (
                  <label className="ve-property-field" key={field}>
                    <span>{label}</span>
                    <input
                      aria-label={`批量${label}`}
                      type="number"
                      step={field.startsWith("scale") ? 0.01 : 1}
                      disabled={disabled}
                      placeholder={
                        !(field in transformDraft) &&
                        transformMixed[field].mixed
                          ? "混合"
                          : undefined
                      }
                      value={transformDisplay(field)}
                      onChange={(event) =>
                        setTransformField(field, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {hasChromaSection ? (
        <section className="ve-inspector-section ve-chroma-section">
          <div className="ve-section-heading">
            <div>
              <h3>抠像</h3>
              <p>
                {chromaClips.length}/{clips.length} 个片段可抠像
                {chromaMixed.enabled.mixed && !("enabled" in chromaDraft)
                  ? " · 启用状态混合"
                  : ""}
              </p>
            </div>
            <label className="ve-chroma-enable">
              <input
                type="checkbox"
                checked={chromaEnabled}
                disabled={disabled}
                aria-label="批量启用抠像"
                onChange={(event) =>
                  setChromaField("enabled", event.target.checked)
                }
              />
              <span>启用</span>
            </label>
          </div>
          <div
            className="ve-batch-mode-options ve-batch-chroma-presets"
            role="group"
            aria-label="抠像参数预设"
          >
            {NAMED_CHROMA_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                disabled={disabled}
                aria-pressed={namedPresetId === preset.id}
                onClick={() => applyNamedPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div
            className={`ve-chroma-controls${chromaEnabled ? "" : " is-disabled"}`}
            aria-disabled={!chromaEnabled}
          >
            <div className="ve-chroma-color-row">
              <div
                className="ve-chroma-presets"
                role="group"
                aria-label="批量抠像颜色"
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
                    aria-pressed={
                      "color" in chromaDraft
                        ? colorLower === preset
                        : !chromaMixed.color.mixed &&
                          chromaMixed.color.value === preset
                    }
                    disabled={disabled || !chromaEnabled}
                    onClick={() => setChromaField("color", preset)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="选择自定义抠像颜色"
                  aria-pressed={
                    ("color" in chromaDraft && isCustomColor) || colorOpen
                  }
                  disabled={disabled || !chromaEnabled}
                  onClick={() => setColorOpen(true)}
                >
                  自定义
                  {!("color" in chromaDraft) && chromaMixed.color.mixed
                    ? " · 混合"
                    : ""}
                </button>
              </div>
              <CustomColorPicker
                compact
                placement="center"
                open={colorOpen}
                onOpenChange={setColorOpen}
                ariaLabel="批量自定义抠像颜色"
                value={chromaColor}
                disabled={disabled || !chromaEnabled}
                onChange={(next) => setChromaField("color", next)}
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
                  value={chromaSliderValue(field)}
                  aria-label={`批量${label}`}
                  disabled={disabled || !chromaEnabled}
                  onChange={(event) =>
                    setChromaField(field, Number(event.target.value))
                  }
                />
                <output>
                  {!(field in chromaDraft) && chromaMixed[field].mixed
                    ? "混合"
                    : Math.round(chromaSliderValue(field))}
                </output>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {!hasAnySection ? (
        <div className="ve-batch-empty">
          <strong>所选片段没有可批量调整的属性</strong>
          <p>音量、静音、画面适配、变换和抠像需要视频、音频或图片片段。</p>
        </div>
      ) : (
        <div className="ve-batch-apply-bar">
          <button
            type="button"
            className="ve-batch-apply"
            disabled={disabled}
            onClick={() => void apply()}
          >
            应用到 {clips.length} 个片段
          </button>
          {message ? (
            <p className="ve-batch-apply-message" aria-live="polite">
              {message}
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
