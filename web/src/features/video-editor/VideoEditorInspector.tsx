import { VideoEditorTextInspector } from "./VideoEditorTextInspector";
import { Diamond, Link, Link2Off, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import { ClipSpeedControl } from "./ClipSpeedControl";
import { VideoEditorChromaInspector } from "./VideoEditorChromaInspector";
import "./video-editor-inspector.css";

const numberValue = (event: React.ChangeEvent<HTMLInputElement>) =>
  Number(event.target.value || 0);

const clipKindLabels: Record<VideoEditorClip["kind"], string> = {
  video: "视频片段",
  audio: "音频片段",
  image: "图片片段",
  text: "文字片段",
  color: "色彩片段",
};

const visualTransitionLabels: Record<string, string> = {
  crossfade: "交叉淡化",
  "fade-black": "黑场过渡",
  "fade-white": "白场过渡",
  wipe: "擦除",
  "wipe-left": "擦除",
  "wipe-right": "擦除",
  zoom: "镜头缩放",
  blur: "径向模糊",
  flash: "闪白",
  "audio-crossfade": "音频淡化",
};

export function VideoEditorInspector({
  clip,
  disabled = false,
  clips = [],
  speedRippleEnabled = true,
  setSpeedRippleEnabled,
  playheadUs,
  commit,
  onOpenClipEdgeTransition,
}: {
  clip?: VideoEditorClip;
  disabled?: boolean;
  clips?: VideoEditorClip[];
  speedRippleEnabled?: boolean;
  setSpeedRippleEnabled?: (value: boolean) => void;
  playheadUs: number;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onOpenClipEdgeTransition?: (clipId: string, edge: "in" | "out") => void;
}) {
  const [transitionDurations, setTransitionDurations] = useState<
    Record<"in" | "out", number>
  >({ in: 500_000, out: 500_000 });
  useEffect(() => {
    setTransitionDurations({
      in: clip?.transitionIn?.durationUs ?? 500_000,
      out: clip?.transitionOut?.durationUs ?? 500_000,
    });
  }, [
    clip?.id,
    clip?.transitionIn?.durationUs,
    clip?.transitionOut?.durationUs,
  ]);
  if (!clip)
    return (
      <aside className="ve-inspector empty">
        <header>
          <div>
            <strong>属性</strong>
            <small>未选择片段</small>
          </div>
        </header>
        <div>
          <Diamond aria-hidden />
          <strong>选择一个 Clip</strong>
          <p>在这里调整位置、缩放、旋转、透明度、音量和关键帧。</p>
        </div>
      </aside>
    );
  const transform = clip.transform ?? {
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    anchor: "center" as const,
    brightness: 1,
  };
  const update = (
    patch: Record<string, unknown>,
    previous: Record<string, unknown>,
  ) =>
    commit(
      [{ type: "updateClip", clipId: clip.id, patch }],
      [{ type: "updateClip", clipId: clip.id, patch: previous }],
    );
  const localUs = Math.max(0, playheadUs - clip.timelineStartUs);
  const addKeyframe = (
    property:
      | "x"
      | "y"
      | "scaleX"
      | "scaleY"
      | "rotation"
      | "opacity"
      | "brightness"
      | "volume",
    value: number,
  ) => {
    const keyframe = {
      id: crypto.randomUUID(),
      property,
      timeUs: Math.min(localUs, clip.durationUs),
      value,
      interpolation: "linear" as const,
    };
    return commit(
      [{ type: "addKeyframe", clipId: clip.id, keyframe }],
      [{ type: "removeKeyframe", clipId: clip.id, keyframeId: keyframe.id }],
    );
  };
  return (
    <aside className="ve-inspector">
      <header>
        <div>
          <strong>属性</strong>
          <small>{clipKindLabels[clip.kind]}</small>
        </div>
        <button
          className="ve-inspector-link-action"
          type="button"
          aria-label={clip.linkGroupId ? "解除片段链接" : "当前片段未链接"}
          title={clip.linkGroupId ? "解除链接" : "当前未链接"}
          disabled={disabled || !clip.linkGroupId}
          onClick={() =>
            void commit([{ type: "unlinkClips", clipId: clip.id }])
          }
        >
          {clip.linkGroupId ? <Link aria-hidden /> : <Link2Off aria-hidden />}
        </button>
      </header>
      <fieldset className="ve-inspector-fields" disabled={disabled}>
        {clip.kind === "text" && (
          <VideoEditorTextInspector
            key={clip.id}
            disabled={disabled}
            clip={clip}
            playheadUs={playheadUs}
            commit={commit}
          />
        )}
        <section className="ve-inspector-section ve-clip-section">
          <div className="ve-section-heading">
            <div>
              <h3>片段信息</h3>
              <p>时间线中的基础信息</p>
            </div>
            <span>{clipKindLabels[clip.kind]}</span>
          </div>
          <label className="ve-stacked-field">
            <span>名称</span>
            <input
              key={`${clip.id}-name-${clip.name}`}
              defaultValue={clip.name}
              onBlur={(event) =>
                event.target.value !== clip.name &&
                void update({ name: event.target.value }, { name: clip.name })
              }
            />
          </label>
          {clip.kind === "color" ? (
            <label className="ve-stacked-field">
              <span>颜色</span>
              <input
                key={`${clip.id}-color-${clip.color}`}
                defaultValue={clip.color ?? "#000000"}
                onBlur={(event) =>
                  event.target.value !== clip.color &&
                  void update(
                    { color: event.target.value },
                    { color: clip.color },
                  )
                }
              />
            </label>
          ) : null}
          <div className="ve-field-grid">
            <label className="ve-stacked-field">
              <span>
                开始时间 <small>秒</small>
              </span>
              <input
                type="number"
                step="0.001"
                key={`start-${clip.timelineStartUs}`}
                defaultValue={(clip.timelineStartUs / 1_000_000).toFixed(3)}
                onBlur={(event) => {
                  const next = Math.max(0, numberValue(event) * 1_000_000);
                  if (next !== clip.timelineStartUs)
                    void commit(
                      [
                        {
                          type: "moveClip",
                          clipId: clip.id,
                          trackId: clip.trackId,
                          timelineStartUs: next,
                        },
                      ],
                      [
                        {
                          type: "moveClip",
                          clipId: clip.id,
                          trackId: clip.trackId,
                          timelineStartUs: clip.timelineStartUs,
                        },
                      ],
                    );
                }}
              />
            </label>
            <label className="ve-stacked-field">
              <span>
                片段时长 <small>秒</small>
              </span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                key={`duration-${clip.durationUs}`}
                defaultValue={(clip.durationUs / 1_000_000).toFixed(3)}
                onBlur={(event) => {
                  const next = Math.max(1000, numberValue(event) * 1_000_000);
                  if (next !== clip.durationUs)
                    void commit(
                      [
                        {
                          type: "trimClip",
                          clipId: clip.id,
                          timelineStartUs: clip.timelineStartUs,
                          durationUs: next,
                          sourceInUs: clip.sourceInUs,
                        },
                      ],
                      [
                        {
                          type: "restoreClipStates",
                          clips: [clip],
                        },
                      ],
                    );
                }}
              />
            </label>
          </div>
        </section>
        {clip.kind === "video" || clip.kind === "audio" ? (
          <ClipSpeedControl
            key={clip.id}
            clip={clip}
            clips={clips}
            ripple={speedRippleEnabled}
            onRippleChange={setSpeedRippleEnabled}
            commit={commit}
          />
        ) : null}
        {clip.kind === "video" || clip.kind === "image" ? (
          <VideoEditorChromaInspector clip={clip} commit={commit} />
        ) : null}
        {clip.kind === "video" ? (
          <section className="ve-inspector-section">
            <div className="ve-section-heading">
              <div>
                <h3>画面适配</h3>
                <p>选择素材填充画布的方式</p>
              </div>
            </div>
            <div
              className="ve-fit-mode-options"
              role="group"
              aria-label="视频画面适配"
            >
              {(
                [
                  ["cover", "铺满裁切"],
                  ["contain", "完整显示"],
                  ["native", "原始尺寸"],
                  ["height", "按高度"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={clip.fitMode === mode}
                  onClick={() => {
                    if (clip.fitMode === mode) return;
                    void update(
                      {
                        fitMode: mode,
                        ...(mode === "height" && !clip.heightPercent
                          ? { heightPercent: 100 }
                          : {}),
                      },
                      {
                        fitMode: clip.fitMode,
                        heightPercent: clip.heightPercent,
                      },
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {clip.fitMode === "height" ? (
              <label>
                高度占画布 (%)
                <input
                  type="number"
                  min="1"
                  max="400"
                  step="1"
                  defaultValue={clip.heightPercent ?? 100}
                  onBlur={(event) => {
                    const value = Math.max(
                      1,
                      Math.min(400, numberValue(event)),
                    );
                    if (value !== (clip.heightPercent ?? 100))
                      void update(
                        { heightPercent: value },
                        { heightPercent: clip.heightPercent },
                      );
                  }}
                />
              </label>
            ) : null}
          </section>
        ) : null}
        {clip.kind !== "audio" ? (
          <section className="ve-inspector-section">
            <div className="ve-section-heading">
              <div>
                <h3>变换</h3>
                <p>调整位置、比例与画面表现</p>
              </div>
            </div>
            <div className="ve-property-grid">
              {(
                [
                  ["x", "位置 X"],
                  ["y", "位置 Y"],
                  ["scaleX", "水平缩放"],
                  ["scaleY", "垂直缩放"],
                  ["rotation", "旋转"],
                  ["opacity", "不透明度"],
                  ["brightness", "亮度"],
                ] as const
              ).map(([property, label]) => (
                <label className="ve-property-field" key={property}>
                  <span>{label}</span>
                  <div className="ve-input-with-action">
                    <input
                      aria-label={label}
                      type="number"
                      step={
                        property.startsWith("scale") ||
                        property === "opacity" ||
                        property === "brightness"
                          ? 0.01
                          : 1
                      }
                      defaultValue={transform[property]}
                      onBlur={(event) => {
                        const value = numberValue(event);
                        if (value !== transform[property])
                          void update(
                            {
                              transform: {
                                ...transform,
                                [property]: numberValue(event),
                              },
                            },
                            { transform },
                          );
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`为${label}添加关键帧`}
                      title={`为${label}添加关键帧`}
                      onClick={() =>
                        void addKeyframe(property, transform[property])
                      }
                    >
                      <Diamond aria-hidden />
                    </button>
                  </div>
                </label>
              ))}
            </div>
          </section>
        ) : null}
        {clip.kind === "video" || clip.kind === "audio" ? (
          <section className="ve-inspector-section">
            <div className="ve-section-heading">
              <div>
                <h3>音频</h3>
                <p>控制片段音量与关键帧</p>
              </div>
            </div>
            <label className="ve-key-field ve-audio-volume-field">
              <span>音量</span>
              <input
                type="number"
                min="0"
                max="4"
                step="0.05"
                defaultValue={clip.volume}
                onBlur={(event) =>
                  numberValue(event) !== clip.volume &&
                  void update(
                    { volume: numberValue(event) },
                    { volume: clip.volume },
                  )
                }
              />
              <button
                type="button"
                aria-label="为音量添加关键帧"
                onClick={() => void addKeyframe("volume", clip.volume)}
              >
                <Diamond aria-hidden />
              </button>
            </label>
          </section>
        ) : null}
        {clip.kind === "audio" ? (
          <section className="ve-inspector-section">
            <div className="ve-section-heading">
              <div>
                <h3>音频转场</h3>
                <p>可放在片段头、片段尾或重叠片段之间</p>
              </div>
            </div>
            <div className="ve-transition-grid">
              {(["in", "out"] as const).map((edge) => {
                const transition =
                  edge === "in" ? clip.transitionIn : clip.transitionOut;
                const durationUs = transitionDurations[edge];
                const edgeLabel = edge === "in" ? "片段头" : "片段尾";
                return (
                  <div
                    className={`ve-transition-card${transition ? " is-active" : ""}`}
                    key={edge}
                  >
                    <div className="ve-transition-card-header">
                      <div>
                        <strong>{edgeLabel}</strong>
                        <small>{transition ? "音频淡化" : "未设置"}</small>
                      </div>
                      <button
                        type="button"
                        aria-pressed={Boolean(transition)}
                        onClick={() =>
                          void commit(
                            [
                              transition
                                ? {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                  }
                                : {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                    transition: {
                                      kind: "audio-crossfade",
                                      durationUs,
                                      direction: "left",
                                      easing: "linear",
                                    },
                                  },
                            ],
                            transition
                              ? [
                                  {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                    transition,
                                  },
                                ]
                              : [
                                  {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                  },
                                ],
                          )
                        }
                      >
                        {transition ? "关闭" : "启用"}
                      </button>
                    </div>
                    <label>
                      <span>
                        持续时间 <small>秒</small>
                      </span>
                      <input
                        aria-label={`${edgeLabel}时长（秒）`}
                        type="number"
                        min="0"
                        max={(clip.durationUs / 1_000_000).toFixed(3)}
                        step="0.1"
                        value={(durationUs / 1_000_000).toFixed(3)}
                        onChange={(event) =>
                          setTransitionDurations((current) => ({
                            ...current,
                            [edge]: Math.max(
                              0,
                              Math.min(
                                clip.durationUs,
                                numberValue(event) * 1_000_000,
                              ),
                            ),
                          }))
                        }
                        onBlur={(event) => {
                          const next = Math.max(
                            0,
                            Math.min(
                              clip.durationUs,
                              numberValue(event) * 1_000_000,
                            ),
                          );
                          setTransitionDurations((current) => ({
                            ...current,
                            [edge]: next,
                          }));
                          if (transition)
                            void update(
                              {
                                [edge === "in"
                                  ? "transitionIn"
                                  : "transitionOut"]: {
                                  ...transition,
                                  durationUs: next,
                                },
                              },
                              {
                                [edge === "in"
                                  ? "transitionIn"
                                  : "transitionOut"]: transition,
                              },
                            );
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        ) : clip.kind === "video" || clip.kind === "image" ? (
          <section className="ve-inspector-section">
            <div className="ve-section-heading">
              <div>
                <h3>转场</h3>
                <p>可放在片段头、片段尾或片段之间</p>
              </div>
            </div>
            <div className="ve-transition-grid">
              {(["in", "out"] as const).map((edge) => {
                const transition =
                  edge === "in" ? clip.transitionIn : clip.transitionOut;
                const durationUs = transitionDurations[edge];
                const edgeLabel = edge === "in" ? "片段头" : "片段尾";
                const kindLabel = transition
                  ? (visualTransitionLabels[transition.kind] ?? transition.kind)
                  : "未设置";
                return (
                  <div
                    className={`ve-transition-card${transition ? " is-active" : ""}`}
                    key={edge}
                  >
                    <div className="ve-transition-card-header">
                      <div>
                        <strong>{edgeLabel}</strong>
                        <small>{kindLabel}</small>
                      </div>
                      <button
                        type="button"
                        aria-pressed={Boolean(transition)}
                        disabled={disabled}
                        onClick={() =>
                          void commit(
                            [
                              transition
                                ? {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                  }
                                : {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                    transition: {
                                      kind: "crossfade",
                                      durationUs,
                                      direction: "left",
                                      easing: "linear",
                                    },
                                  },
                            ],
                            transition
                              ? [
                                  {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                    transition,
                                  },
                                ]
                              : [
                                  {
                                    type: "setTransition",
                                    clipId: clip.id,
                                    edge,
                                  },
                                ],
                          )
                        }
                      >
                        {transition ? "取消" : "启用"}
                      </button>
                    </div>
                    <label>
                      <span>
                        持续时间 <small>秒</small>
                      </span>
                      <input
                        aria-label={`${edgeLabel}时长（秒）`}
                        type="number"
                        min="0"
                        max={(clip.durationUs / 1_000_000).toFixed(3)}
                        step="0.1"
                        disabled={disabled}
                        value={(durationUs / 1_000_000).toFixed(3)}
                        onChange={(event) =>
                          setTransitionDurations((current) => ({
                            ...current,
                            [edge]: Math.max(
                              0,
                              Math.min(
                                clip.durationUs,
                                numberValue(event) * 1_000_000,
                              ),
                            ),
                          }))
                        }
                        onBlur={(event) => {
                          const next = Math.max(
                            0,
                            Math.min(
                              clip.durationUs,
                              numberValue(event) * 1_000_000,
                            ),
                          );
                          setTransitionDurations((current) => ({
                            ...current,
                            [edge]: next,
                          }));
                          if (transition)
                            void update(
                              {
                                [edge === "in"
                                  ? "transitionIn"
                                  : "transitionOut"]: {
                                  ...transition,
                                  durationUs: next,
                                },
                              },
                              {
                                [edge === "in"
                                  ? "transitionIn"
                                  : "transitionOut"]: transition,
                              },
                            );
                        }}
                      />
                    </label>
                    {onOpenClipEdgeTransition ? (
                      <button
                        type="button"
                        className="ve-transition-card-link"
                        disabled={disabled}
                        onClick={() => onOpenClipEdgeTransition(clip.id, edge)}
                      >
                        {transition ? "更换效果…" : "从效果库选择…"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        <section className="ve-inspector-section ve-keyframe-section">
          <div className="ve-section-heading">
            <div>
              <h3>关键帧</h3>
              <p>在播放头位置记录参数变化</p>
            </div>
            <span>{clip.keyframes?.length ?? 0}</span>
          </div>
          <div className="ve-keyframes">
            {(clip.keyframes?.length ?? 0) === 0 ? (
              <p className="ve-keyframes-empty">
                点击参数旁的菱形按钮添加关键帧
              </p>
            ) : null}
            {(clip.keyframes ?? []).map((keyframe) => (
              <div key={keyframe.id}>
                <Diamond aria-hidden />
                <span>
                  {keyframe.property} ·{" "}
                  {(keyframe.timeUs / 1_000_000).toFixed(3)}s
                </span>
                <button
                  className="ve-key-easing"
                  type="button"
                  title="切换插值"
                  onClick={() => {
                    const modes = [
                      "linear",
                      "ease-in",
                      "ease-out",
                      "ease-in-out",
                    ] as const;
                    const interpolation =
                      modes[
                        (modes.indexOf(keyframe.interpolation) + 1) %
                          modes.length
                      ]!;
                    void commit(
                      [
                        {
                          type: "updateKeyframe",
                          clipId: clip.id,
                          keyframe: { ...keyframe, interpolation },
                        },
                      ],
                      [
                        {
                          type: "updateKeyframe",
                          clipId: clip.id,
                          keyframe,
                        },
                      ],
                    );
                  }}
                >
                  {keyframe.interpolation}
                </button>
                <button
                  type="button"
                  aria-label="删除关键帧"
                  onClick={() =>
                    void commit([
                      {
                        type: "removeKeyframe",
                        clipId: clip.id,
                        keyframeId: keyframe.id,
                      },
                    ])
                  }
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </section>
      </fieldset>
    </aside>
  );
}
