import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { thoughtKeys } from "@features/thought-workshop/queryKeys";
import { presentationKeys } from "@features/presentation-workshop/queryKeys";
import { audioAnnotationQueryKeys } from "@features/audio-annotation/queryKeys";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  subscribeResourceRevisions,
  type ResourceRevisionMessage,
} from "@platform/sync/resourceBroadcast";

export function invalidateResourceRevision(
  client: QueryClient,
  message: ResourceRevisionMessage,
): void {
  switch (message.kind) {
    case "thought-note":
      void client.invalidateQueries({
        queryKey: thoughtKeys.note(message.id),
      });
      void client.invalidateQueries({ queryKey: thoughtKeys.projectLists() });
      break;
    case "presentation-project":
      void client.invalidateQueries({
        queryKey: presentationKeys.project(message.id),
      });
      void client.invalidateQueries({
        queryKey: presentationKeys.projects(),
      });
      break;
    case "audio-annotation":
      void client.invalidateQueries({
        queryKey: audioAnnotationQueryKeys.document(message.id),
      });
      void client.invalidateQueries({
        queryKey: audioAnnotationQueryKeys.project(message.id),
      });
      break;
    case "galgame-story":
      void client.invalidateQueries({
        queryKey: galgameQueryKeys.story(message.id),
      });
      void client.invalidateQueries({
        queryKey: galgameQueryKeys.project(message.id),
      });
      break;
    case "visual-canvas":
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.canvas(message.id),
      });
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.project(message.id),
      });
      break;
  }
}

export function useResourceBroadcastSync(
  client: QueryClient,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeResourceRevisions((message) =>
      invalidateResourceRevision(client, message),
    );
  }, [client, enabled]);
}
