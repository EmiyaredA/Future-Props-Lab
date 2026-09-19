import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import { externalizeDocument, getDirectorProject, hydrateDocument, patchDirectorProject } from "./api";
import type { SceneDocument } from "./editor/scenes/sequence-project";
import { directorDeskKeys } from "./queryKeys";
import "./editor/style.css";

export function DirectorDeskEditorPage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const revision = useRef(0);
  const [openError, setOpenError] = useState("");
  const project = useQuery({
    queryKey: directorDeskKeys.project(projectId),
    queryFn: ({ signal }) => getDirectorProject(projectId, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const data = project.data;
    if (!data) return undefined;
    revision.current = data.revision;
    let dispose = () => {};
    let cancelled = false;
    void import("./editor/main.ts").then(async ({ mountDirectorEditor }) => {
      if (cancelled) return;
      let scene: unknown;
      try {
        scene = await hydrateDocument(projectId, data.document);
      } catch (error) {
        if (!cancelled) setOpenError(error instanceof Error ? error.message : "预演工程无法打开");
        return;
      }
      if (cancelled) return;
      try {
        dispose = mountDirectorEditor({
          name: data.title,
          projectId,
          document: scene as SceneDocument,
          onSave: async (document) => {
            try {
              const slim = await externalizeDocument(projectId, document);
              const saved = await patchDirectorProject(projectId, {
                title: document.name,
                expected_revision: revision.current,
                document: slim,
              });
              revision.current = saved.revision;
            } catch (error) {
              if (error instanceof ApiError && error.status === 409)
                throw new Error("工程已在其他页面更新，请返回后重新打开");
              throw error instanceof Error ? error : new Error("工程保存失败");
            }
          },
        });
        document.getElementById("director-desk-back")?.addEventListener("click", () => onBackRef.current());
      } catch (error) {
        if (!cancelled)
          setOpenError(error instanceof Error ? error.message : "预演工程无法打开");
      }
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [project.data, projectId]);

  if (project.isError || openError) {
    const text = openError || (project.error instanceof Error ? project.error.message : "预演工程无法打开");
    return (
      <section className="workshop-page">
        <p role="alert">{text}</p>
        <button type="button" className="btn" onClick={onBack}>
          返回工程列表
        </button>
      </section>
    );
  }

  return (
    <div className="director-desk-root" data-project-id={projectId}>
      {project.isPending ? <p className="director-desk-boot">正在打开预演…</p> : null}
      <div id="app" />
    </div>
  );
}
