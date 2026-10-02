import { canvasText, parseCanvasScene } from "../diagrams/model";
const sources = import.meta.glob("./content/technical/figures/*.json", {
  import: "default",
});
export async function loadOfficialCanvas(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("无效的官方画板标识");
  const load = sources[`./content/technical/figures/${id}.json`];
  if (!load) throw new Error("官方画板不存在");
  return parseCanvasScene(await load());
}
export async function officialSearchText(markdown: string) {
  const ids = [
    ...markdown.matchAll(/```fpl-canvas\s*\n([a-z0-9-]+)\s*\n```/g),
  ].map((m) => m[1]);
  const scenes = await Promise.all(ids.map(loadOfficialCanvas));
  return [markdown, ...scenes.map(canvasText)].join("\n");
}
