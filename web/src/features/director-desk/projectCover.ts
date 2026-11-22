import { getDirectorProject, hydrateDocument } from "./api";

/** Render one saved scene with the production engine. No editor shell or save callbacks. */
export async function renderDirectorCover(
  projectId: string,
  revision: number | null | undefined,
  signal: AbortSignal,
) {
  const snapshot = await getDirectorProject(projectId, signal);
  if (revision != null && snapshot.revision !== revision)
    throw new Error("场景预览版本已变化");
  const hydrated = await hydrateDocument(projectId, snapshot.document, signal);
  signal.throwIfAborted();
  const [
    { Engine },
    { readSceneDocument, projectForScene },
    { entity, aspectNumber },
  ] = await Promise.all([
    import("./editor/engine"),
    import("./editor/scenes/sequence-project"),
    import("./editor/model"),
  ]);
  signal.throwIfAborted();
  const document = readSceneDocument(hydrated);
  const project = projectForScene(document);
  if (!project.entities.length && !project.room.enabled)
    throw new Error("场景暂无内容");
  if (!project.entities.some((item) => item.kind === "camera")) {
    const camera = entity("camera", "camera", "预览机位", [7, 5.9, 7]);
    camera.camera!.hideWalls = ["south", "east", "ceiling"];
    project.entities.push(camera);
  }
  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  const stage = window.document.createElement("div"),
    shot = window.document.createElement("div");
  stage.style.cssText = shot.style.cssText = "width:640px;height:360px";
  host.append(stage, shot);
  window.document.body.append(host);
  let engine: InstanceType<typeof Engine> | undefined;
  const noop = () => {};
  try {
    engine = new Engine(
      {
        ...project,
        entities: project.entities.filter((item) => item.kind === "camera"),
        resources: [],
      },
      stage,
      shot,
      {
        select: noop,
        point: noop,
        ground: noop,
        transformStart: noop,
        transform: noop,
        transformEnd: noop,
      },
    );
    engine.pickingEnabled = false;
    await engine.externalModels.prepare(project, signal);
    signal.throwIfAborted();
    engine.rebuild(project);
    const time = Math.max(0, project.cuts[0]?.time ?? 0);
    await engine.prepareOutput(time, signal);
    const aspect = aspectNumber(project.aspect);
    const canvas = engine.renderOutput(time, 640, Math.round(640 / aspect));
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("场景预览无法读取")),
        "image/webp",
        0.85,
      ),
    );
    signal.throwIfAborted();
    return blob;
  } finally {
    engine?.dispose();
    host.remove();
  }
}
