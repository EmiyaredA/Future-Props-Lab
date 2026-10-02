import {
  createDirectorProject,
  deleteDirectorProject,
  externalizeDocument,
  getDirectorProject,
  hydrateDocument,
  patchDirectorProject,
} from "./api";

export async function importDirectorFile(file: File): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("这不是有效的 .director 工程");
  }
  const { readSceneDocument } =
    await import("./editor/scenes/sequence-project.ts");
  const document = readSceneDocument(parsed);
  const name = document.name.slice(0, 120);
  document.name = name;
  const created = await createDirectorProject(name);
  try {
    const slim = await externalizeDocument(created.id, document);
    await patchDirectorProject(created.id, {
      title: name,
      expected_revision: created.revision,
      document: slim,
    });
  } catch (error) {
    await deleteDirectorProject(created.id, created.revision).catch(
      () => undefined,
    );
    throw error;
  }
  return created.id;
}

export async function exportDirectorFile(projectId: string, title: string) {
  const current = await getDirectorProject(projectId);
  const document = await hydrateDocument(projectId, current.document);
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  const safe = title.replace(/[<>:"/\\|?*]/g, "_") || "预演工程";
  anchor.href = url;
  anchor.download = `${safe}.director`;
  anchor.click();
  URL.revokeObjectURL(url);
}
