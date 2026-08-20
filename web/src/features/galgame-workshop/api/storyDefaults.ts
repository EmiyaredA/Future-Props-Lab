import type {
  GalgameStoryCharacterStageSettings,
  GalgameStoryProject,
} from "./types";

export const DEFAULT_CHARACTER_POSITION_PRESETS = [
  { id: "position-outer-left", name: "极左", x: 12, y: 50 },
  {
    id: "position-left",
    name: "左",
    x: 25,
    y: 50,
    builtinKey: "left" as const,
  },
  {
    id: "position-center-left",
    name: "中左",
    x: 37.5,
    y: 50,
    builtinKey: "centerLeft" as const,
  },
  {
    id: "position-center",
    name: "中",
    x: 50,
    y: 50,
    builtinKey: "center" as const,
  },
  {
    id: "position-center-right",
    name: "中右",
    x: 62.5,
    y: 50,
    builtinKey: "centerRight" as const,
  },
  {
    id: "position-right",
    name: "右",
    x: 75,
    y: 50,
    builtinKey: "right" as const,
  },
  { id: "position-outer-right", name: "极右", x: 88, y: 50 },
];

export const DEFAULT_STORY_SETTINGS = {
  canvas: { width: 1920, height: 1080 },
  characterStage: {
    anchor: "center" as const,
    defaultPositionId: "position-center",
    defaultHeightPercent: 100,
    positionPresets: DEFAULT_CHARACTER_POSITION_PRESETS,
  },
} satisfies NonNullable<GalgameStoryProject["settings"]>;

export type ResolvedCharacterStageSettings = Omit<
  GalgameStoryCharacterStageSettings,
  "positionPresets"
> & {
  positionPresets: NonNullable<
    GalgameStoryCharacterStageSettings["positionPresets"]
  >;
};

export function normalizeCharacterStageSettings(
  settings?: GalgameStoryCharacterStageSettings,
): ResolvedCharacterStageSettings {
  const sourcePresets = settings?.positionPresets?.length
    ? settings.positionPresets.map((preset) => ({ ...preset }))
    : DEFAULT_CHARACTER_POSITION_PRESETS.map((preset) => ({ ...preset }));
  const baselineY =
    sourcePresets.find((preset) => preset.id === "position-center")?.y ??
    sourcePresets[0]?.y ??
    50;
  const positionPresets = [...sourcePresets];
  if (!positionPresets.some((preset) => preset.id === "position-outer-left")) {
    positionPresets.unshift({
      ...DEFAULT_CHARACTER_POSITION_PRESETS[0],
      y: baselineY,
    });
  }
  if (!positionPresets.some((preset) => preset.id === "position-outer-right")) {
    positionPresets.push({
      ...DEFAULT_CHARACTER_POSITION_PRESETS.at(-1)!,
      y: baselineY,
    });
  }

  return {
    ...DEFAULT_STORY_SETTINGS.characterStage,
    ...settings,
    positionPresets,
  };
}
