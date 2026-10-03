export type PreviewIdentity = {
  projectId: string;
  sessionId: string;
  baseRevision: number;
};
export type PreviewDraft = PreviewIdentity & {
  sequence: number;
  config: Record<string, unknown>;
  skinId: string | null;
  eventName: string;
  mode: "inspect" | "event" | "runtime";
  key: number;
  line: number;
  motionDemo?:
    "held" | "climb-left" | "climb-right" | "glide-left" | "glide-right" | null;
};
export type PreviewStatus = {
  sessionId: string | null;
  state: "idle" | "active" | "paused" | "error";
  message: string;
};
const events = ["idle", "click", "pet", "grab", "drop", "roam"];
const actions = ["dress", "roam", "hide", "settings", "chat"];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("预览结构无效");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("预览包含未允许的字段");
}
function id(value: unknown, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new Error("预览标识无效");
}
function integer(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("预览版本无效");
}
export function previewIdentity(value: unknown): PreviewIdentity {
  const item = record(value);
  id(item.projectId);
  id(item.sessionId);
  integer(item.baseRevision);
  return {
    projectId: item.projectId as string,
    sessionId: item.sessionId as string,
    baseRevision: item.baseRevision as number,
  };
}
export function previewDraft(value: unknown): PreviewDraft {
  if (JSON.stringify(value).length > 65536) throw new Error("预览数据过大");
  const item = record(value);
  keys(item, [
    "projectId",
    "sessionId",
    "baseRevision",
    "sequence",
    "config",
    "skinId",
    "eventName",
    "mode",
    "key",
    "line",
    "motionDemo",
  ]);
  const identity = previewIdentity(item);
  integer(item.sequence);
  integer(item.key);
  integer(item.line);
  if (
    item.motionDemo !== undefined &&
    item.motionDemo !== null &&
    ![
      "held",
      "climb-left",
      "climb-right",
      "glide-left",
      "glide-right",
    ].includes(item.motionDemo as string)
  )
    throw new Error("预览姿态无效");
  id(item.skinId, true);
  if (
    !events.includes(item.eventName as string) ||
    !["inspect", "event", "runtime"].includes(item.mode as string) ||
    (item.line as number) > 7
  )
    throw new Error("预览播放状态无效");
  const config = record(item.config);
  keys(config, [
    "schemaVersion",
    "events",
    "habits",
    "skins",
    "activeSkinId",
    "schemeId",
  ]);
  if (config.schemaVersion !== 2) throw new Error("预览配置版本无效");
  id(config.activeSkinId, true);
  id(config.schemeId, true);
  const reactions = record(config.events);
  keys(reactions, events);
  for (const value of Object.values(reactions)) {
    const reaction = record(value);
    keys(reaction, ["motionId", "expressionId", "lines", "sound"]);
    id(reaction.motionId, true);
    id(reaction.expressionId, true);
    if (
      !["none", "tap", "chime"].includes(reaction.sound as string) ||
      !Array.isArray(reaction.lines) ||
      reaction.lines.length > 8 ||
      reaction.lines.some(
        (line) => typeof line !== "string" || line.length > 140,
      )
    )
      throw new Error("预览事件无效");
  }
  const habits = record(config.habits);
  keys(habits, [
    "roam",
    "size",
    "draggable",
    "bubbles",
    "sound",
    "edgeClimbing",
    "highGliding",
    "hoverActions",
    "edgeClimbing",
    "highGliding",
  ]);
  if (
    !["off", "calm", "free"].includes(habits.roam as string) ||
    !Number.isInteger(habits.size) ||
    (habits.size as number) < 160 ||
    (habits.size as number) > 300 ||
    [habits.draggable, habits.bubbles, habits.sound].some(
      (value) => typeof value !== "boolean",
    ) ||
    [habits.edgeClimbing, habits.highGliding].some(
      (value) => value !== undefined && typeof value !== "boolean",
    ) ||
    !Array.isArray(habits.hoverActions) ||
    [habits.edgeClimbing, habits.highGliding].some(
      (value) => value !== undefined && typeof value !== "boolean",
    ) ||
    habits.hoverActions.length > 4 ||
    new Set(habits.hoverActions).size !== habits.hoverActions.length ||
    habits.hoverActions.some((action) => !actions.includes(action))
  )
    throw new Error("预览习惯无效");
  if (!Array.isArray(config.skins) || config.skins.length > 20)
    throw new Error("预览皮肤无效");
  const skinIds = new Set<string>();
  for (const value of config.skins) {
    const skin = record(value);
    keys(skin, ["id", "name", "replacements"]);
    id(skin.id);
    if (
      skinIds.has(skin.id as string) ||
      typeof skin.name !== "string" ||
      !skin.name.length ||
      skin.name.length > 60
    )
      throw new Error("预览皮肤无效");
    skinIds.add(skin.id as string);
    const replacements = record(skin.replacements);
    if (Object.keys(replacements).length > 128) throw new Error("预览贴图过多");
    for (const [source, target] of Object.entries(replacements)) {
      id(source);
      id(target);
    }
  }
  if (
    config.activeSkinId !== null &&
    !skinIds.has(config.activeSkinId as string)
  )
    throw new Error("预览默认皮肤不存在");
  return {
    ...identity,
    sequence: item.sequence as number,
    config,
    skinId: item.skinId as string | null,
    eventName: item.eventName as string,
    mode: item.mode as PreviewDraft["mode"],
    key: item.key as number,
    line: item.line as number,
    motionDemo: item.motionDemo as PreviewDraft["motionDemo"],
  };
}
