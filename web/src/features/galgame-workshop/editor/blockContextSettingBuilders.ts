import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { BlockKind } from "@features/galgame-workshop/editor/model";

export type BlockOf<K extends BlockKind> = Extract<
  GalgameStoryBlock,
  { type: K }
>;

export type BlockContextSetting = {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  description: string;
  apply: (block: GalgameStoryBlock) => GalgameStoryBlock;
};

export type BlockContextSection = {
  label: string;
  settings: BlockContextSetting[];
};

export type BlockContextSettings = {
  sections: BlockContextSection[];
  includeInspector: boolean;
};

export type Context = { story: GalgameStoryProject };
export type Factory<K extends BlockKind> = (
  block: BlockOf<K>,
  context: Context,
) => BlockContextSettings;
export type Registry = { [K in BlockKind]: Factory<K> };

export const option = <K extends BlockKind>(
  block: BlockOf<K>,
  id: string,
  label: string,
  checked: boolean,
  description: string,
  update: (block: BlockOf<K>) => BlockOf<K>,
  disabled = false,
): BlockContextSetting => ({
  id: `context-${block.type}-${id}`,
  label,
  checked,
  disabled,
  description,
  apply: (current) =>
    current.type === block.type ? update(current as BlockOf<K>) : current,
});

export const section = (
  label: string,
  settings: BlockContextSetting[],
): BlockContextSection => ({ label, settings });

export const bool = <K extends BlockKind>(
  block: BlockOf<K>,
  id: string,
  label: string,
  checked: boolean,
  description: string,
  update: (block: BlockOf<K>, value: boolean) => BlockOf<K>,
) =>
  option(block, id, label, checked, description, (current) =>
    update(current, !checked),
  );

export const durationOptions = <K extends BlockKind>(
  block: BlockOf<K>,
  currentMs: number | null | undefined,
  values: number[],
  update: (block: BlockOf<K>, durationMs: number) => BlockOf<K>,
) =>
  values.map((durationMs) =>
    option(
      block,
      `duration-${durationMs}`,
      durationMs === 0 ? "立即" : `${durationMs}ms`,
      currentMs === durationMs,
      `将当前${block.type}卡片的时长设置为 ${durationMs}ms。`,
      (current) => update(current, durationMs),
    ),
  );

export const audioRole = {
  bgm: "backgroundMusic",
  ambient: "ambientSound",
  sfx: "soundEffect",
} as const;

export const characterTransform = (
  value: BlockOf<"showCharacter">["transform"],
) => ({
  x: 50,
  y: 100,
  anchor: "bottomCenter" as const,
  scale: 1,
  brightness: 1,
  opacity: 1,
  flipX: false,
  layer: 10,
  ...value,
});

export const characterTransition = (
  value:
    | BlockOf<"showCharacter">["transition"]
    | BlockOf<"removeCharacter">["transition"],
) => ({ durationMs: 240, fade: true, ...value });

export const cgOverlay = (value: BlockOf<"showCg">["overlay"]) => ({
  x: 50,
  y: 50,
  width: 60,
  opacity: 1,
  placement: "frontOfCharacters" as const,
  ...value,
});

export const cgTransition = (
  value: BlockOf<"showCg">["transition"] | BlockOf<"hideCg">["transition"],
) => ({ durationMs: 400, fade: true, ...value });
