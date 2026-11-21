import type { ReactNode } from "react";
import { lazy, Suspense, useState } from "react";
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
const StoryboardWorkspace = lazy(
  () => import("./storyboard/StoryboardWorkspace"),
);
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
  const [creative, setCreative] = useState<"script" | "cards" | "storyboard">();
  const [previs, setPrevis] = useState(false);
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
        {creative === "storyboard" ? (
          <StoryboardWorkspace
            project={projectId}
            nodes={canvas.data?.nodes ?? []}
            projectCardIds={canvas.data?.project_card_ids ?? []}
            readOnly
            onScript={() => setCreative("script")}
            onLocateNode={() => setCreative(undefined)}
            onCreateNode={async () => {
              throw new Error("只读项目");
            }}
            renderHeader={() => (
              <header className="visual-previs-readonly-header">
                <button onClick={() => setCreative(undefined)}>返回项目</button>
                <strong>{project.data?.title}</strong>
                {utilities}
              </header>
            )}
          />
        ) : creative === "script" ? (
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
          <button onClick={() => setCreative("script")}>分集剧本</button>
          <button onClick={() => setCreative("cards")}>设定卡</button>
          <button onClick={() => setCreative("storyboard")}>分镜</button>
          <button onClick={() => setPrevis(true)}>白模预演</button>
        </>
      )}
    </ReadOnlyPage>
  );
}
