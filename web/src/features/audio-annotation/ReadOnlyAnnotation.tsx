import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReadOnlyCollection,
  ReadOnlyPage,
  ReadOnlyWorkshopLibrary,
} from "@shared/ui/ReadOnlyPage";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import {
  getAudioAnnotationDocument,
  getAudioAnnotationProject,
  listAudioAnnotationProjects,
} from "./api";
import { audioAnnotationQueryKeys as keys } from "./queryKeys";
export function ReadOnlyAnnotation({
  utilities,
  projectId,
  onOpen,
  onBack,
}: {
  utilities?: ReactNode;
  projectId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const projects = useQuery({
    queryKey: keys.projectList(""),
    queryFn: () => listAudioAnnotationProjects(),
    enabled: !projectId,
  });
  const project = useQuery({
    queryKey: keys.project(projectId || ""),
    queryFn: () => getAudioAnnotationProject(projectId!),
    enabled: !!projectId,
  });
  const document = useQuery({
    queryKey: keys.document(projectId || ""),
    queryFn: () => getAudioAnnotationDocument(projectId!),
    enabled: !!projectId,
  });
  if (!projectId && utilities) {
    return (
      <ReadOnlyWorkshopLibrary
        title="我的标注任务"
        utilities={utilities}

        error={projects.error}
        loading={projects.isPending}
        items={projects.data?.items ?? []}
        onOpen={onOpen}
      />
    );
  }
  return (
    <ReadOnlyPage
      utilities={utilities}
      title={project.data?.title || "录音标注"}
      error={projects.error || project.error || document.error}
      loading={projectId ? document.isPending : projects.isPending}
      onBack={projectId ? onBack : undefined}
    >
      {!projectId ? (
        <ReadOnlyCollection
          items={projects.data?.items || []}
          onOpen={onOpen}
        />
      ) : (
        <>
          {project.data ? (
            <ReadOnlyMedia
              path={`/v1/files/${encodeURIComponent(project.data.asset_id)}/content`}
              kind="audio"
              name={project.data.original_filename}
            />
          ) : null}
          {document.data?.segments.map((segment) => (
            <article key={segment.id}>
              <small>
                {(segment.start_ms / 1000).toFixed(2)} –{" "}
                {(segment.end_ms / 1000).toFixed(2)} 秒 ·{" "}
                {document.data.speakers
                  .filter(
                    (s) =>
                      s.id === segment.speaker_id ||
                      segment.speaker_ids?.includes(s.id),
                  )
                  .map((s) => s.name)
                  .join("、")}
              </small>
              <p>{segment.text}</p>
              {segment.localized_texts?.map((text) => (
                <p key={text.language}>
                  {text.language}：{text.text}
                </p>
              ))}
            </article>
          ))}
        </>
      )}
    </ReadOnlyPage>
  );
}
