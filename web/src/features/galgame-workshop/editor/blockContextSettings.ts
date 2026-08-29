import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  type BlockContextSettings,
  type Context,
  type Registry,
} from "@features/galgame-workshop/editor/blockContextSettingBuilders";
import { textBlockContextSettings } from "@features/galgame-workshop/editor/story-authoring/block-settings/text";
import { stageBlockContextSettings } from "@features/galgame-workshop/editor/story-authoring/block-settings/stage";
import { mediaBlockContextSettings } from "@features/galgame-workshop/editor/story-authoring/block-settings/media";
import { presentationBlockContextSettings } from "@features/galgame-workshop/editor/story-authoring/block-settings/presentation";
import { flowBlockContextSettings } from "@features/galgame-workshop/editor/story-authoring/block-settings/flow";

const registry = {
  ...textBlockContextSettings,
  ...stageBlockContextSettings,
  ...mediaBlockContextSettings,
  ...presentationBlockContextSettings,
  ...flowBlockContextSettings,
} satisfies Registry;

export const BLOCK_CONTEXT_SETTINGS_REGISTRY = registry;

export function blockContextSettings(
  block: GalgameStoryBlock,
  story: GalgameStoryProject,
): BlockContextSettings {
  const factory = registry[block.type] as (
    block: GalgameStoryBlock,
    context: Context,
  ) => BlockContextSettings;
  return factory(block, { story });
}
