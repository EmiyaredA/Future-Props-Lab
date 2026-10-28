import { useEffect } from "react";
import type { components } from "@generated/api";
import type { VideoMode } from "./options";

type VideoDraft = components["schemas"]["VisualCanvasVideoGenerationDraft"];
type VideoCaps = components["schemas"]["VideoCapabilitiesOut"];

export function useVideoDefaults(
  caps: VideoCaps | null | undefined,
  draft: VideoDraft | null | undefined,
  setResolution: (value: VideoDraft["resolution"]) => void,
  setRatio: (value: VideoDraft["ratio"]) => void,
  setMode: (value: VideoMode) => void,
  setGenerateAudio: (value: boolean) => void,
) {
  useEffect(() => {
    if (caps?.supported_modes?.length === 1)
      setMode(caps.supported_modes[0] as VideoMode);
    if (
      !caps?.default_resolution ||
      (draft?.model_id && caps.resolutions.includes(draft.resolution))
    )
      return;
    setResolution(caps.default_resolution as VideoDraft["resolution"]);
    setRatio((caps.default_ratio ?? "9:16") as VideoDraft["ratio"]);
    setMode((caps.supported_modes?.[0] ?? "reference") as VideoMode);
  }, [
    caps,
    draft?.model_id,
    draft?.resolution,
    setResolution,
    setRatio,
    setMode,
  ]);

  useEffect(() => {
    if (caps && (!draft?.model_id || draft.generate_audio == null))
      setGenerateAudio(caps.default_generate_audio ?? true);
  }, [caps, draft?.model_id, draft?.generate_audio, setGenerateAudio]);
}
