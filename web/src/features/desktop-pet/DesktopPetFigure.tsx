import { forwardRef } from "react";
import type { PetDocument } from "./api";
import { PetRenderer, type PetRendererHandle } from "./PetRenderer";
import { WhaleRenderer } from "./WhaleRenderer";

export const DesktopPetFigure = forwardRef<
  PetRendererHandle,
  {
    document: PetDocument;
    skinId?: string | null;
    eventName?: string;
    reactionKey?: number;
    view?: "center" | "floor";
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
    />
  );
});
