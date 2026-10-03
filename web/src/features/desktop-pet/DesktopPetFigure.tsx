import { forwardRef } from "react";
import type { PetDocument } from "./api";
import { PetRenderer, type PetRendererHandle } from "./PetRenderer";
import { WhaleRenderer } from "./WhaleRenderer";
import type { PetPlaybackMode } from "./playback";
import type { PetMotionFrame } from "@platform/petMotion";
import type { MotionDemo } from "./locomotion/demo";

export const DesktopPetFigure = forwardRef<
  PetRendererHandle,
  {
    document: PetDocument;
    skinId?: string | null;
    eventName?: string;
    reactionKey?: number;
    view?: "center" | "floor";
    dragged?: boolean;
    playbackMode?: PetPlaybackMode;
    locomotion?: PetMotionFrame | null;
    motionDemo?: MotionDemo | null;
  }
>(function DesktopPetFigure(props, ref) {
  return props.document.sourceType === "coopanion-whale" ? (
    <WhaleRenderer ref={ref} {...props} />
  ) : (
    <PetRenderer
      ref={ref}
      document={props.document}
      skinId={props.skinId}
      eventName={props.eventName}
      reactionKey={props.reactionKey}
      playbackMode={props.playbackMode}
    />
  );
});
