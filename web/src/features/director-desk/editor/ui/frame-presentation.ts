import type { Entity, Project } from "../model.ts";
import type { projectSceneLabels } from "../editor/scene-projection.ts";
import { $, escape, icon } from "./common.ts";

type FramePresentation = {
  snapTarget: string;
  camera: Entity;
  preview: string;
  aspect: Project["aspect"];
  position: { x: number; y: number; z: number };
  room: Project["room"];
  selected: string;
  labels?: ReturnType<typeof projectSceneLabels>;
};

export function createFramePresentation() {
  const labelNodes = new Map<string, HTMLButtonElement>();
  const frameFields = new Map(
    ["object-snap-status", "shot-name", "shot-lens", "shot-warning"].map(
      (id) => [id, $("#" + id)],
    ),
  );
  function frameText(id: string, value: string) {
    const node = frameFields.get(id)!;
    if (node.textContent !== value) node.textContent = value;
  }
  return ({
    snapTarget,
    camera,
    preview,
    aspect,
    position: p,
    room: r,
    selected,
    labels,
  }: FramePresentation) => {
    frameText("object-snap-status", snapTarget ? `已吸附：${snapTarget}` : "");
    frameText(
      "shot-name",
      camera.name + (preview === "program" ? " · 成片" : ""),
    );
    frameText("shot-lens", `${camera.camera!.focal} mm · ${aspect}`);
    const outside =
      r.enabled &&
      (Math.abs(p.x) > r.width / 2 ||
        Math.abs(p.z) > r.depth / 2 ||
        p.y > r.height ||
        p.y < 0);
    const hiddenObjects = camera.camera!.hiddenEntityIds?.length ?? 0;
    frameText(
      "shot-warning",
      hiddenObjects
        ? `本机位隐藏 ${hiddenObjects} 个对象${camera.camera!.hideWalls.length ? `、${camera.camera!.hideWalls.length} 面房间墙体` : ""}`
        : outside && !camera.camera!.hideWalls.length
          ? "机位在房间外 · 墙体保留"
          : camera.camera!.hideWalls.length
            ? `已移除 ${camera.camera!.hideWalls.length} 面拍摄墙体`
            : "同场景真实取景",
    );
    if (!labels) return;
    const ids = new Set(labels.map((l) => l.id));
    for (const [id, node] of labelNodes)
      if (!ids.has(id)) {
        node.remove();
        labelNodes.delete(id);
      }
    for (const l of labels) {
      let node = labelNodes.get(l.id);
      if (!node) {
        node = document.createElement("button");
        node.dataset.select = l.id;
        $("#object-labels").append(node);
        labelNodes.set(l.id, node);
      }
      const className = "object-label" + (l.id === selected ? " active" : "");
      if (node.className !== className) node.className = className;
      if (node.style.left !== l.x + "px") node.style.left = l.x + "px";
      if (node.style.top !== l.y + "px") node.style.top = l.y + "px";
      if (node.hidden === l.visible) node.hidden = !l.visible;
      if (node.dataset.name !== l.name || node.dataset.color !== l.color) {
        node.innerHTML = `<i style="background:${l.color}"></i>${escape(l.name)}`;
        node.dataset.name = l.name;
        node.dataset.color = l.color;
      }
    }
  };
}

function timeCode(t: number, fps: number) {
  const frames = Math.round(t * fps),
    f = frames % fps,
    s = Math.floor(frames / fps);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
export function presentPlayback(time: number, fps: number, playing: boolean) {
  const labelTime = timeCode(time, fps);
  $("#timecode").textContent = labelTime;
  $("#shot-time").textContent = labelTime;
  $("#timeline-content").style.setProperty("--timeline-playhead", String(time));
  const play = $<HTMLButtonElement>('[data-act="play"]');
  const label = playing ? "暂停" : "播放";
  // Preserve the pointer target between press and release, including a slow click.
  if (play.getAttribute("aria-label") !== label) {
    play.innerHTML = icon(playing ? "pause" : "play");
    play.setAttribute("aria-label", label);
  }
}
