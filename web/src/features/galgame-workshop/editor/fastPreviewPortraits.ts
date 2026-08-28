import type { GalgameStoryProject } from "@features/galgame-workshop/api";

export function revealHiddenDialoguePortraits(
  document: GalgameStoryProject,
): GalgameStoryProject {
  return {
    ...document,
    chapters: document.chapters?.map((chapter) => ({
      ...chapter,
      fragments: chapter.fragments?.map((fragment) => ({
        ...fragment,
        blocks: fragment.blocks?.map((block) =>
          block.type === "dialogue" && block.portrait?.visible === false
            ? {
                ...block,
                portrait: {
                  ...block.portrait,
                  visible: true,
                  keepAfter: false,
                },
              }
            : block,
        ),
      })),
    })),
  };
}
