import { CustomSelect } from "@shared/ui/CustomSelect";
import { AudioInspectorFields } from "@features/galgame-workshop/editor/AudioInspectorFields";
import { CurtainInspectorFields } from "@features/galgame-workshop/editor/CurtainInspectorFields";
import { Field } from "@features/galgame-workshop/editor/InspectorFieldControls";
import { WaitInspectorFields } from "@features/galgame-workshop/editor/WaitInspectorFields";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function MediaBlockInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  const { block, document, patch } = model;
  if (block.type === "wait") return <WaitInspectorFields model={model} />;
  if (block.type === "audio") return <AudioInspectorFields model={model} />;
  if (block.type === "curtain") return <CurtainInspectorFields model={model} />;
  if (block.type !== "video") return null;
  return (
    <>
      <Field label="视频动作">
        <CustomSelect
          ariaLabel="视频动作"
          value={block.action}
          options={[
            { value: "play", label: "播放 / 切换" },
            { value: "stop", label: "停止视频" },
          ]}
          onChange={(action) =>
            patch((current) => {
              if (current.type !== "video") return current;
              if (action === "stop")
                return {
                  ...current,
                  action: "stop",
                  assetId: null,
                  waitForCompletion: false,
                };
              const asset = (document.assets ?? []).find(
                (candidate) => candidate.type === "video",
              );
              return asset
                ? { ...current, action: "play", assetId: asset.id }
                : current;
            })
          }
        />
      </Field>
      {block.action === "play" ? (
        <>
          <Field label="视频素材">
            <CustomSelect
              ariaLabel="视频素材"
              value={block.assetId ?? ""}
              options={(document.assets ?? [])
                .filter((asset) => asset.type === "video")
                .map((asset) => ({
                  value: asset.id,
                  label: asset.label,
                }))}
              onChange={(assetId) =>
                patch((current) =>
                  current.type === "video" ? { ...current, assetId } : current,
                )
              }
            />
          </Field>
          <Field label="画面适配">
            <CustomSelect
              ariaLabel="视频画面适配"
              value={block.fit}
              options={[
                { value: "cover", label: "铺满裁切" },
                { value: "contain", label: "完整显示" },
              ]}
              onChange={(fit) =>
                patch((current) =>
                  current.type === "video"
                    ? { ...current, fit: fit as "cover" | "contain" }
                    : current,
                )
              }
            />
          </Field>
          <label className="galgame-audio-range">
            <span>
              视频音量 <em>{block.volume}%</em>
            </span>
            <input
              aria-label="视频音量"
              type="range"
              min="0"
              max="100"
              value={block.volume}
              onChange={(event) =>
                patch((current) =>
                  current.type === "video"
                    ? { ...current, volume: Number(event.target.value) }
                    : current,
                )
              }
            />
          </label>
          <label className="galgame-audio-loop">
            <input
              type="checkbox"
              checked={block.loop}
              onChange={(event) =>
                patch((current) =>
                  current.type === "video"
                    ? {
                        ...current,
                        loop: event.target.checked,
                        waitForCompletion: event.target.checked
                          ? false
                          : current.waitForCompletion,
                      }
                    : current,
                )
              }
            />
            <span>循环播放</span>
          </label>
          <label className="galgame-audio-loop">
            <input
              type="checkbox"
              checked={block.waitForCompletion}
              disabled={block.loop}
              onChange={(event) =>
                patch((current) =>
                  current.type === "video"
                    ? {
                        ...current,
                        waitForCompletion: event.target.checked,
                      }
                    : current,
                )
              }
            />
            <span>播放完成后继续</span>
          </label>
        </>
      ) : null}
    </>
  );
}
