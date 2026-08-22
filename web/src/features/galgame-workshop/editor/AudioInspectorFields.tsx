import { CustomSelect } from "@shared/ui/CustomSelect";
import "@features/galgame-workshop/galgameStyles";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/InspectorFieldControls";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";
const AUDIO_INSPECTOR_CHANNELS = [
  { value: "bgm", label: "背景音乐", code: "BGM", role: "backgroundMusic" },
  { value: "sfx", label: "音效", code: "SE", role: "soundEffect" },
  {
    value: "ambient",
    label: "环境音",
    code: "AMBIENT",
    role: "ambientSound",
  },
] as const;

function audioInspectorRole(
  channel: (typeof AUDIO_INSPECTOR_CHANNELS)[number]["value"],
) {
  return AUDIO_INSPECTOR_CHANNELS.find((option) => option.value === channel)!
    .role;
}

export function AudioInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, document, patch } = model;
  if (!block || block.type !== "audio" || !document || !patch) return null;
  return (
    <div className="galgame-audio-inspector">
      <div className="galgame-audio-inspector-section">
        <span className="galgame-audio-inspector-label">动作</span>
        <div
          className="galgame-audio-action-tabs"
          role="group"
          aria-label="声音动作"
        >
          {[
            { value: "play", label: "播放 / 切换" },
            { value: "stop", label: "停止通道" },
          ].map((action) => {
            const disabled =
              action.value === "play" &&
              block.action === "stop" &&
              !(document.assets ?? []).some(
                (asset) =>
                  asset.type === "audio" &&
                  asset.role === audioInspectorRole(block.channel),
              );
            return (
              <button
                key={action.value}
                type="button"
                className={block.action === action.value ? "active" : ""}
                aria-pressed={block.action === action.value}
                disabled={disabled}
                onClick={() =>
                  patch((current) => {
                    if (current.type !== "audio") return current;
                    if (action.value === "stop")
                      return { ...current, action: "stop", assetId: null };
                    const asset = (document.assets ?? []).find(
                      (candidate) =>
                        candidate.type === "audio" &&
                        candidate.role === audioInspectorRole(current.channel),
                    );
                    return asset
                      ? {
                          ...current,
                          action: "play",
                          assetId: asset.id,
                        }
                      : current;
                  })
                }
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="galgame-audio-inspector-section">
        <span className="galgame-audio-inspector-label">类型</span>
        <div
          className="galgame-audio-type-tabs"
          role="group"
          aria-label="声音类型"
        >
          {AUDIO_INSPECTOR_CHANNELS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={block.channel === option.value ? "active" : ""}
              aria-pressed={block.channel === option.value}
              onClick={() =>
                patch((current) => {
                  if (current.type !== "audio") return current;
                  const nextChannel = option.value;
                  const defaults =
                    nextChannel === "sfx"
                      ? { volume: 100, loop: false, fadeMs: 0 }
                      : { volume: 70, loop: true, fadeMs: 1000 };
                  const asset = (document.assets ?? []).find(
                    (candidate) =>
                      candidate.type === "audio" &&
                      candidate.role === option.role,
                  );
                  return {
                    ...current,
                    channel: nextChannel,
                    assetId:
                      current.action === "play" ? (asset?.id ?? null) : null,
                    ...defaults,
                  };
                })
              }
            >
              <span>{option.label}</span>
              <small>{option.code}</small>
            </button>
          ))}
        </div>
      </div>
      {block.action === "play" ? (
        <Field label="声音素材">
          <CustomSelect
            ariaLabel="声音素材"
            value={block.assetId ?? ""}
            options={[
              {
                value: "",
                label: "点击选择音频文件…",
                disabled: true,
              },
              ...(document.assets ?? [])
                .filter(
                  (asset) =>
                    asset.type === "audio" &&
                    asset.role === audioInspectorRole(block.channel),
                )
                .map((asset) => ({
                  value: asset.id,
                  label: asset.type === "audio" ? asset.label : "未知声音",
                })),
            ]}
            onChange={(assetId) =>
              patch((current) =>
                current.type === "audio"
                  ? { ...current, assetId: assetId || null }
                  : current,
              )
            }
          />
        </Field>
      ) : null}
      <Field label="音轨 ID">
        <input aria-label="音轨 ID" value={block.channel} readOnly />
        <small className="galgame-audio-track-hint">
          同一音轨的新声音会替换当前声音，停止指令也按此音轨生效。
        </small>
      </Field>
      {block.action === "play" ? (
        <>
          <label className="galgame-audio-control-row">
            <span>音量</span>
            <div>
              <input
                aria-label="播放音量"
                className="galgame-audio-number"
                type="number"
                min="0"
                max="100"
                step="1"
                value={block.volume}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "audio"
                      ? {
                          ...current,
                          volume: Math.min(
                            100,
                            Math.max(0, Number(event.target.value)),
                          ),
                        }
                      : current,
                  )
                }
              />
              <em>%</em>
              <input
                aria-label="播放音量滑杆"
                type="range"
                min="0"
                max="100"
                step="1"
                value={block.volume}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "audio"
                      ? { ...current, volume: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </div>
          </label>
          <label className="galgame-audio-switch">
            <span>循环播放</span>
            <input
              type="checkbox"
              checked={block.loop}
              onChange={(event) =>
                patch((current) =>
                  current.type === "audio"
                    ? { ...current, loop: event.target.checked }
                    : current,
                )
              }
            />
            <i aria-hidden />
          </label>
          <label className="galgame-audio-control-row">
            <span>淡入时长</span>
            <div>
              <input
                aria-label="淡入时间"
                className="galgame-audio-number"
                type="number"
                min="0"
                max="10000"
                step="100"
                value={block.fadeMs}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "audio"
                      ? {
                          ...current,
                          fadeMs: Math.min(
                            10000,
                            Math.max(0, Number(event.target.value)),
                          ),
                        }
                      : current,
                  )
                }
              />
              <em>ms</em>
              <input
                aria-label="淡入时间滑杆"
                type="range"
                min="0"
                max="10000"
                step="100"
                value={block.fadeMs}
                onChange={(event) =>
                  patch((current) =>
                    current.type === "audio"
                      ? { ...current, fadeMs: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </div>
          </label>
        </>
      ) : (
        <label className="galgame-audio-control-row">
          <span>淡出时长</span>
          <div>
            <input
              aria-label="淡出时间"
              className="galgame-audio-number"
              type="number"
              min="0"
              max="10000"
              step="100"
              value={block.fadeMs}
              onChange={(event) =>
                patch((current) =>
                  current.type === "audio"
                    ? {
                        ...current,
                        fadeMs: Math.min(
                          10000,
                          Math.max(0, Number(event.target.value)),
                        ),
                      }
                    : current,
                )
              }
            />
            <em>ms</em>
            <input
              aria-label="淡出时间滑杆"
              type="range"
              min="0"
              max="10000"
              step="100"
              value={block.fadeMs}
              onChange={(event) =>
                patch((current) =>
                  current.type === "audio"
                    ? { ...current, fadeMs: Number(event.target.value) }
                    : current,
                )
              }
            />
          </div>
        </label>
      )}
    </div>
  );
}
