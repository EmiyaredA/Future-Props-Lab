import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import { getDirectorProject, patchDirectorProject } from "./api";
import { directorDeskKeys } from "./queryKeys";

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
    void import("./editor/main.ts").then(({ mountDirectorEditor }) => {
      if (cancelled) return;
      dispose = mountDirectorEditor({
        name: data.title,
        document: data.document,
        onSave: async (document) => {
          try {
            const saved = await patchDirectorProject(projectId, {
              title: document.name,
              expected_revision: revision.current,
              document: {
                format: "director-desk",
                version: 3,
                name: document.name,
                activeSceneId: document.activeSceneId,
                resources: document.resources,
                media: document.media,
                scenes: document.scenes,
              },
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
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [project.data, projectId]);

  if (project.isError) {
    return (
      <section className="workshop-page">
        <p role="alert">{project.error instanceof Error ? project.error.message : "预演工程无法打开"}</p>
        <button type="button" className="btn" onClick={onBack}>
          返回工程列表
        </button>
      </section>
    );
  }

  return (
    <div className="director-desk-root" data-project-id={projectId}>
      <div id="app" />
    </div>
  );
}
