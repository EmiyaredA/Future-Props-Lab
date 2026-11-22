import type { PromptReferenceSlots } from "./promptRendering";
import { orderedReferenceIds, uniqueAssetIds } from "./referenceOrder";

/** Resolve provider label slots from actual inputs, never from loaded file order. */
export function promptReferenceSlotsForInputs({
  videoMode,
  framesOnly,
  firstFrame,
  lastFrame,
  imageReferences,
  videoReferences,
  audioReferences,
  linkedAssetIds,
}: {
  videoMode: string;
  framesOnly: boolean;
  firstFrame: string[];
  lastFrame: string[];
  imageReferences: string[];
  videoReferences: string[];
  audioReferences: string[];
  linkedAssetIds: { image: string[]; video: string[]; audio: string[] };
}): PromptReferenceSlots {
  const linkedFrames = framesOnly
    ? uniqueAssetIds(firstFrame, lastFrame, linkedAssetIds.image)
    : [];
  const first = firstFrame[0] ?? linkedFrames.find((id) => id !== lastFrame[0]);
  const last = lastFrame[0] ?? linkedFrames.find((id) => id !== first);
  if (videoMode === "frames") return { picture: [first, last] };
  if (videoMode === "image") return { picture: [first] };
  if (videoMode !== "reference") return {};
  return {
    picture: imageReferences,
    video: orderedReferenceIds(videoReferences, linkedAssetIds.video),
    audio: orderedReferenceIds(audioReferences, linkedAssetIds.audio),
  };
}
