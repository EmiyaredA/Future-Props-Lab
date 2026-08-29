import type { GenerationDrawerProps } from "@features/visual-workshop/generation/generationDrawerTypes";
import { useGenerationDrawerController } from "@features/visual-workshop/generation/useGenerationDrawerController";
import { CompactImageGenerationDrawer } from "@features/visual-workshop/generation/CompactImageGenerationDrawer";
import { CompactVideoGenerationDrawer } from "@features/visual-workshop/generation/CompactVideoGenerationDrawer";
import { StandardGenerationDrawer } from "@features/visual-workshop/generation/StandardGenerationDrawer";

export function GenerationDrawer(props: GenerationDrawerProps) {
  const controller = useGenerationDrawerController(props);
  if (controller.compact && controller.lockedKind === "image") {
    return <CompactImageGenerationDrawer controller={controller} />;
  }
  if (controller.compact && controller.lockedKind === "video") {
    return <CompactVideoGenerationDrawer controller={controller} />;
  }
  return <StandardGenerationDrawer controller={controller} />;
}
