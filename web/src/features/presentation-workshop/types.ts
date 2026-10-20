import type { components } from "@generated/api";

export type Deck = components["schemas"]["PresentationDocument"];
export type Slide = components["schemas"]["PresentationSlide"];
export type SlideElement = components["schemas"]["PresentationElement"];
export type Paragraph = components["schemas"]["PresentationParagraph"];
export type TextRun = components["schemas"]["PresentationRun"];
export type Project = components["schemas"]["PresentationProjectOut"];
export type ProjectSummary =
  components["schemas"]["PresentationProjectSummary"];
export type Draft = Pick<Project, "title" | "document">;
export type NavigationGuard = (
  guard: ((proceed: () => void) => boolean) | null,
) => void;

export type PageSize = Pick<Deck, "width" | "height">;
export const defaultPageSize: PageSize = { width: 1280, height: 720 };
