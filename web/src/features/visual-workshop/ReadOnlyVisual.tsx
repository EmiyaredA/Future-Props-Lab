import type { ReactNode } from "react";
import { useState } from "react";
import { NodeAcceptancePanel } from "./acceptance/NodeAcceptancePanel";
import { AcceptanceWorkspace } from "./acceptance/AcceptanceWorkspace";
import { ReadOnlyVisualConversation } from "./ReadOnlyVisualConversation";
import { useQuery } from "@tanstack/react-query";
import {
  ReadOnlyCollection,
  ReadOnlyPage,
  ReadOnlyWorkshopLibrary,
} from "@shared/ui/ReadOnlyPage";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import {
  getVisualWorkshopProjects,
  getVisualCanvas,
  getVisualWorkshopProject,
} from "./api";
import { visualWorkshopQueryKeys } from "./queryKeys";
export function ReadOnlyVisual({
  utilities,
  libraryActions,
  projectId,
  onOpen,
  onBack,
}: {
  utilities?: ReactNode;
  libraryActions?: ReactNode;
  projectId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [acceptance, setAcceptance] = useState(false);
  const [inspection, setInspection] = useState<{
    nodeId: string;
    outputId?: string;
  }>();
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
  if (inspection && projectId)
    return (
      <ReadOnlyPage
        utilities={utilities}
        title={`${project.data?.title ?? "视觉工坊"} · 节点验收`}
        onBack={() => setInspection(undefined)}
      >
        <NodeAcceptancePanel
          key={inspection.nodeId}
          projectId={projectId}
          nodeId={inspection.nodeId}
          outputId={inspection.outputId}
          readOnly
          onTemplates={() => setInspection(undefined)}
          onGeneration={() => {
            setInspection(undefined);
            setAcceptance(false);
          }}
        />
      </ReadOnlyPage>
    );
  if (acceptance && projectId && canvas.data)
    return (
      <AcceptanceWorkspace
        projectId={projectId}
        title={project.data?.title ?? "视觉工坊"}
        nodes={canvas.data.nodes}
        readOnly
        initialTab="summary"
        onOpenNode={(nodeId, outputId) => setInspection({ nodeId, outputId })}
        onBack={() => setAcceptance(false)}
      />
    );
  if (!projectId && utilities) {
    return (
      <ReadOnlyWorkshopLibrary
        title="我的创作项目"
        utilities={utilities}
        actions={libraryActions}
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
      {projectId && (
        <button onClick={() => setAcceptance(true)}>查看项目验收</button>
      )}
      {projectId ? (
        <ReadOnlyVisualConversation key={projectId} projectId={projectId} />
      ) : null}
    </ReadOnlyPage>
  );
}
