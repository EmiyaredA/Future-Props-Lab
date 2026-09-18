import { AUDIO_ANNOTATION_MODULE } from "@features/audio-annotation/module";
import { PRESENTATION_WORKSHOP_MODULE } from "@features/presentation-workshop/module";
import { THOUGHT_WORKSHOP_MODULE } from "@features/thought-workshop/module";
import { GALGAME_WORKSHOP_MODULE } from "@features/galgame-workshop/module";
import { VISUAL_WORKSHOP_MODULE } from "@features/visual-workshop/module";
import { VIDEO_EDITOR_MODULE } from "@features/video-editor/module";

export const APPLICATION_MODULES = [
  PRESENTATION_WORKSHOP_MODULE,
  THOUGHT_WORKSHOP_MODULE,
  VISUAL_WORKSHOP_MODULE,
  GALGAME_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  AUDIO_ANNOTATION_MODULE,
] as const;

export const APPLICATION_DEFINITIONS = APPLICATION_MODULES.map(
  (application) => application.definition,
);

export function matchApplicationPath(pathname: string) {
  for (const application of APPLICATION_MODULES) {
    const match = application.matchPath(pathname);
    if (match) return match;
  }
  return undefined;
}

export function applicationPathFor(
  page: string,
  projectId?: string,
  documentId?: string,
) {
  for (const application of APPLICATION_MODULES) {
    const path = (
      application as import("@features/applications/module").ApplicationModule
    ).pathFor(page, projectId, documentId);
    if (path) return path;
  }
  return undefined;
}

export {
  AUDIO_ANNOTATION_MODULE,
  GALGAME_WORKSHOP_MODULE,
  VIDEO_EDITOR_MODULE,
  VISUAL_WORKSHOP_MODULE,
};

export { THOUGHT_WORKSHOP_MODULE };

export { PRESENTATION_WORKSHOP_MODULE };
