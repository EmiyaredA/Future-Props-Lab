import { ReadOnlyVisualConversation } from "./ReadOnlyVisualConversation";
import { useQuery } from "@tanstack/react-query";
import { ReadOnlyCollection, ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import {
  getVisualWorkshopProjects,
  getVisualCanvas,
  getVisualWorkshopProject,
} from "./api";
import { visualWorkshopQueryKeys } from "./queryKeys";
export function ReadOnlyVisual({
  projectId,
  onOpen,
  onBack,
}: {
  projectId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const projects = useQuery({
    queryKey: visualWorkshopQueryKeys.projects,
    queryFn: getVisualWorkshopProjects,
    enabled: !projectId,
  });
  const project = useQuery({
    queryKey: visualWorkshopQueryKeys.project(projectId || ""),
    queryFn: () => getVisualWorkshopProject(projectId!),
    enabled: !!projectId,
  });
  const canvas = useQuery({
    queryKey: visualWorkshopQueryKeys.canvas(projectId || ""),
    queryFn: () => getVisualCanvas(projectId!),
    enabled: !!projectId,
  });
  return (
    <ReadOnlyPage
      title={project.data?.title || "视觉工坊"}
      loading={projectId ? canvas.isPending : projects.isPending}
      error={projects.error || project.error || canvas.error}
      onBack={projectId ? onBack : undefined}
    >
      {!projectId ? (
        <ReadOnlyCollection
          items={projects.data?.items || []}
          onOpen={onOpen}
        />
      ) : (
        <div className="readonly-media-grid">
          {canvas.data?.nodes.map((node) => (
            <article key={node.id}>
              <h2>{node.title || (node.kind === "text" ? "文本" : "素材")}</h2>
              {node.kind === "text" ? (
                <p>{node.text}</p>
              ) : node.asset_id ? (
                <ReadOnlyMedia
                  path={`/v1/files/${encodeURIComponent(node.asset_id)}/content`}
                  kind={node.kind}
                  name={node.title || node.id}
                />
              ) : (
                <p>暂无已生成素材。</p>
              )}
            </article>
          ))}
        </div>
      )}
      {projectId ? (
        <ReadOnlyVisualConversation key={projectId} projectId={projectId} />
      ) : null}
    </ReadOnlyPage>
  );
}
