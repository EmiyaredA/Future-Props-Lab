import type { ComponentProps } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { VideoSubjectControl } from "./VideoSubjectControl";
import { VideoSeedControl } from "./VideoSeedControl";
import { WorkflowVideoControls } from "./WorkflowVideoControls";
import { type VideoCapabilities, videoChoices } from "./videoCapabilities";
import type { Ratio, Resolution } from "./modelGenerationOptions";

type Props = {
  videoCaps?: VideoCapabilities | null;
  duration: number;
  setDuration: (value: number) => void;
  choices: ReturnType<typeof videoChoices>;
  workflowValues: Record<string, string>;
  setWorkflowValues: (value: Record<string, string>) => void;
  workflow?:
    ComponentProps<typeof WorkflowVideoControls>["capabilities"] | null;
  resolution: Resolution;
  setResolution: (value: Resolution) => void;
  effectiveRatio: string;
  setRatio: (value: Ratio) => void;
  generateAudio: boolean;
  setGenerateAudio: (value: boolean) => void;
  watermark: boolean;
  setWatermark: (value: boolean) => void;
};

export function ModelVideoParameters({
  videoCaps,
  duration,
  setDuration,
  choices,
  workflowValues,
  setWorkflowValues,
  workflow,
  resolution,
  setResolution,
  effectiveRatio,
  setRatio,
  generateAudio,
  setGenerateAudio,
  watermark,
  setWatermark,
}: Props) {
  return (
    <>
      {videoCaps?.supports_duration !== false && (
        <label>
          <span>{videoCaps?.duration_label ?? "时长"}</span>
          <CustomSelect
            ariaLabel="时长"
            className="generation-parameter-select generation-duration-select"
            value={String(duration)}
            options={choices.durations}
            onChange={(value) => setDuration(Number(value))}
          />
        </label>
      )}
      {videoCaps?.supports_video_subject_to_replace && (
        <VideoSubjectControl
          value={workflowValues.video_subject_to_replace ?? ""}
          onChange={(value) =>
            setWorkflowValues({
              ...workflowValues,
              video_subject_to_replace: value,
            })
          }
        />
      )}
      <VideoSeedControl
        capabilities={videoCaps}
        value={workflowValues.seed ?? ""}
        onChange={(seed) => setWorkflowValues({ ...workflowValues, seed })}
      />
      {workflow ? (
        <WorkflowVideoControls
          capabilities={workflow}
          values={workflowValues}
          onChange={setWorkflowValues}
        />
      ) : (
        <fieldset className="generation-fieldset">
          <legend>分辨率</legend>
          <div
            className="generation-segmented"
            role="group"
            aria-label="分辨率"
          >
            {choices.resolutions.map((item) => (
              <button
                type="button"
                aria-pressed={resolution === item}
                className={resolution === item ? "active" : ""}
                key={item}
                onClick={() => setResolution(item as Resolution)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {videoCaps?.supports_ratio !== false &&
        (!workflow || workflow.supports_ratio) && (
          <fieldset className="generation-fieldset">
            <legend>比例</legend>
            <div
              className="generation-ratio-options"
              role="group"
              aria-label="比例"
            >
              {choices.ratios.map((item) => (
                <button
                  type="button"
                  aria-pressed={effectiveRatio === item}
                  className={effectiveRatio === item ? "active" : ""}
                  key={item}
                  onClick={() => setRatio(item as Ratio)}
                >
                  <i
                    className={`generation-ratio-shape ratio-${item.replace(":", "-")}`}
                    aria-hidden
                  />
                  <span>{item === "adaptive" ? "自适应" : item}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
      {!workflow &&
        videoCaps?.supports_watermark !== false &&
        videoCaps?.supports_generate_audio !== false && (
          <div className="generation-switches">
            <label className="generation-switch-row">
              <span>
                <strong>生成音频</strong>
                <small>为视频同步生成声音</small>
              </span>
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(event) => setGenerateAudio(event.target.checked)}
              />
              <i aria-hidden />
            </label>
            <label className="generation-switch-row">
              <span>
                <strong>保留水印</strong>
                <small>在生成结果中保留平台标记</small>
              </span>
              <input
                type="checkbox"
                checked={watermark}
                onChange={(event) => setWatermark(event.target.checked)}
              />
              <i aria-hidden />
            </label>
          </div>
        )}
    </>
  );
}
