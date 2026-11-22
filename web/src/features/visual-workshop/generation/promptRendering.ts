import { minimaxH3PromptRenderer } from "./minimaxH3PromptRenderer";

export type PromptRenderToken = {
  kind:
    | "text"
    | "subject"
    | "picture"
    | "video"
    | "audio"
    | "shot"
    | "time"
    | "dialogue"
    | "marker"
    | "speaker"
    | "relationship"
    | "task"
    | "language";
  text: string;
  children?: PromptRenderToken[];
};

export type PromptRenderBlock = {
  kind: "paragraph" | "shot";
  tokens: PromptRenderToken[];
};

export type PromptRenderSection = {
  field?: string;
  title?: string;
  /** Original heading, including its colon and indentation. */
  heading: string;
  blocks: PromptRenderBlock[];
  /** Display-only omission; heading and tokens still reconstruct the source. */
  hidden?: boolean;
  hideHeading?: boolean;
};

/** Ordered input slots, including IDs whose metadata has not loaded yet. */
export type PromptReferenceSlots = Partial<
  Record<"picture" | "video" | "audio", readonly (string | undefined)[]>
>;

export type PromptRenderDocument = { sections: PromptRenderSection[] };

export type PromptRenderAdapter = {
  id: string;
  label: string;
  shortLabel?: string;
  parse: (prompt: string) => PromptRenderDocument | null;
};

export const promptRenderAdapters: readonly PromptRenderAdapter[] = [
  minimaxH3PromptRenderer,
];

export function resolvePromptRendering(prompt: string, template = "auto") {
  if (template === "plain") return null;
  for (const adapter of promptRenderAdapters) {
    if (template !== "auto" && template !== adapter.id) continue;
    const document = adapter.parse(prompt);
    if (document) return { adapter, document };
  }
  return null;
}
