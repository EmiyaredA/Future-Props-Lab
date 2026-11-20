import type { ReactNode } from "react";
import { lazy, Suspense, useState } from "react";
import { NodeAcceptancePanel } from "./acceptance/NodeAcceptancePanel";
import { AcceptanceWorkspace } from "./acceptance/AcceptanceWorkspace";
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
const ScriptWorkspace = lazy(() => import("./creative/ScriptWorkspace"));
const AssetCards = lazy(() =>
  import("./creative/AssetCards").then(({ AssetCards }) => ({
    default: AssetCards,
  })),
);
const PrevisWorkspace = lazy(() => import("./previs/PrevisWorkspace"));

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
  const [creative, setCreative] = useState<"script" | "cards">();
  const [previs, setPrevis] = useState(false);
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
  if (creative && projectId)
    return (
      <Suspense fallback={<p role="status">正在打开项目资料…</p>}>
        {creative === "script" ? (
          <ScriptWorkspace
            project={projectId}
            readOnly
            renderHeader={() => (
              <header className="visual-previs-readonly-header">
                <button onClick={() => setCreative(undefined)}>返回项目</button>
                <strong>{project.data?.title}</strong>
                {utilities}
              </header>
            )}
          />
        ) : (
          <ReadOnlyPage
            utilities={utilities}
            title={`${project.data?.title ?? "视觉工坊"} · 设定卡`}
            onBack={() => setCreative(undefined)}
          >
            <AssetCards project={projectId} readOnly />
          </ReadOnlyPage>
        )}
      </Suspense>
    );
  if (previs && projectId)
    return (
      <Suspense fallback={<p role="status">正在打开白模预演…</p>}>
        <PrevisWorkspace
          projectId={projectId}
          projectTitle={project.data?.title}
          utilities={utilities}
          readOnly
          onBack={() => setPrevis(false)}
        />
      </Suspense>
    );
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
        <>
          <button onClick={() => setAcceptance(true)}>查看项目验收</button>
          <button onClick={() => setCreative("script")}>分集剧本</button>
          <button onClick={() => setCreative("cards")}>设定卡</button>
          <button onClick={() => setPrevis(true)}>白模预演</button>
        </>
      )}
    </ReadOnlyPage>
  );
}
