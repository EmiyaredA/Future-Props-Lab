import { Diamond, Link, Link2Off, Trash2 } from "lucide-react";
import type { VideoEditorClip, VideoEditorOperation } from "./types";

const numberValue = (event: React.ChangeEvent<HTMLInputElement>) =>
  Number(event.target.value || 0);

export function VideoEditorInspector({
  clip,
  playheadUs,
  commit,
}: {
  clip?: VideoEditorClip;
  playheadUs: number;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  if (!clip)
    return (
      <aside className="ve-inspector empty">
        <header>
          <strong>属性</strong>
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
          <small>{clip.kind}</small>
        </div>
        <button
          title={clip.linkGroupId ? "解除链接" : "当前未链接"}
          disabled={!clip.linkGroupId}
          onClick={() =>
            void commit([{ type: "unlinkClips", clipId: clip.id }])
          }
        >
          {clip.linkGroupId ? <Link aria-hidden /> : <Link2Off aria-hidden />}
        </button>
      </header>
      <section>
        <label>
          名称
          <input
            key={`${clip.id}-name-${clip.name}`}
            defaultValue={clip.name}
            onBlur={(event) =>
              event.target.value !== clip.name &&
              void update({ name: event.target.value }, { name: clip.name })
            }
          />
        </label>
        {clip.kind === "text" ? (
          <label>
            文字
            <textarea
              key={`${clip.id}-text-${clip.text}`}
              defaultValue={clip.text ?? ""}
              onBlur={(event) =>
                event.target.value !== clip.text &&
                void update({ text: event.target.value }, { text: clip.text })
              }
            />
          </label>
        ) : null}
        {clip.kind === "color" ? (
          <label>
            颜色
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
        <label className="ve-key-field">
          <span>开始 (s)</span>
          <input
            type="number"
            step="0.001"
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
          <span />
        </label>
        <label className="ve-key-field">
          <span>时长 (s)</span>
          <input
            type="number"
            min="0.001"
            step="0.001"
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
                      type: "trimClip",
                      clipId: clip.id,
                      timelineStartUs: clip.timelineStartUs,
                      durationUs: clip.durationUs,
                      sourceInUs: clip.sourceInUs,
                    },
                  ],
                );
            }}
          />
          <span />
        </label>
      </section>
      {clip.kind !== "audio" ? (
        <section>
          <h3>变换</h3>
          {(
            [
              "x",
              "y",
              "scaleX",
              "scaleY",
              "rotation",
              "opacity",
              "brightness",
            ] as const
          ).map((property) => (
            <label className="ve-key-field" key={property}>
              <span>{property}</span>
              <input
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
                aria-label={`为 ${property} 添加关键帧`}
                onClick={() => void addKeyframe(property, transform[property])}
              >
                <Diamond aria-hidden />
              </button>
            </label>
          ))}
        </section>
      ) : (
        <section>
          <h3>音频</h3>
          <label className="ve-key-field">
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
            <button onClick={() => void addKeyframe("volume", clip.volume)}>
              <Diamond aria-hidden />
            </button>
          </label>
        </section>
      )}
      <section>
        <h3>转场</h3>
        <div className="ve-transition-buttons">
          {(clip.kind === "audio"
            ? ["audio-crossfade"]
            : ["crossfade", "fade-black", "fade-white"]
          ).map((kind) => (
            <button
              key={kind}
              onClick={() =>
                void commit([
                  {
                    type: "setTransition",
                    clipId: clip.id,
                    edge: "in",
                    transition: {
                      kind: kind as "crossfade",
                      durationUs: 500_000,
                    },
                  },
                ])
              }
            >
              {kind}
            </button>
          ))}
          <button
            onClick={() =>
              void commit([
                { type: "setTransition", clipId: clip.id, edge: "in" },
              ])
            }
          >
            清除
          </button>
        </div>
      </section>
      <section>
        <h3>关键帧 · {clip.keyframes?.length ?? 0}</h3>
        <div className="ve-keyframes">
          {(clip.keyframes ?? []).map((keyframe) => (
            <div key={keyframe.id}>
              <Diamond aria-hidden />
              <span>
                {keyframe.property} · {(keyframe.timeUs / 1_000_000).toFixed(3)}
                s
              </span>
              <button
                className="ve-key-easing"
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
                      (modes.indexOf(keyframe.interpolation) + 1) % modes.length
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
    </aside>
  );
}
