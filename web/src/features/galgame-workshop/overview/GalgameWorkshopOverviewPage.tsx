import { AmadeusButton } from "@platform/AmadeusButton";
import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  MapPinned,
  RefreshCcw,
  Users,
  X,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  patchGalgameWorkshopProject,
  type GalgameWorkshopProject,
} from "@features/galgame-workshop/api";
import "@features/galgame-workshop/galgameStyles";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";

const PROJECT_KEY = galgameQueryKeys.project;
const STORY_KEY = galgameQueryKeys.story;

const MODULES = [
  {
    id: "script",
    title: "剧本编辑",
    description: "编辑单章 Fragment、对白、旁白、场景、分支与结局。",
    icon: BookOpenText,
  },
  {
    id: "characters",
    title: "角色",
    description: "维护对白可引用的角色名称与稳定设定。",
    icon: Users,
  },
  {
    id: "scenes",
    title: "场景",
    description: "维护场景设定，并在试玩舞台中使用确定性占位视觉。",
    icon: MapPinned,
  },
  {
    id: "report",
    title: "工程检查",
    description: "检查入口、可达 Fragment、分支、循环与双结局线路。",
    icon: CheckCircle2,
  },
] as const;

function countItems(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "工程已在其他页面更新，内容已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function GalgameWorkshopOverviewPage({
  projectId,
  onProjects,
  onOpenEditor,
}: {
  projectId: string;
  onProjects: () => void;
  onOpenEditor: () => void;
}) {
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const projectQuery = useQuery({
    queryKey: PROJECT_KEY(projectId),
    queryFn: () => getGalgameWorkshopProject(projectId),
  });
  const storyQuery = useQuery({
    queryKey: STORY_KEY(projectId),
    queryFn: () => getGalgameStoryDocument(projectId),
  });
  const reportQuery = useQuery({
    queryKey: ["galgame-workshop-story-report", projectId],
    queryFn: () => getGalgameStoryReport(projectId),
  });
  const patchMutation = useMutation({
    mutationFn: (changes: Partial<Pick<GalgameWorkshopProject, "status">>) =>
      patchGalgameWorkshopProject(projectQuery.data!, changes),
    onSuccess: (updated) => {
      client.setQueryData(PROJECT_KEY(projectId), updated);
      void client.invalidateQueries({
        queryKey: ["galgame-workshop-projects"],
      });
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      void projectQuery.refetch();
    },
  });
  const project = projectQuery.data;
  const document = storyQuery.data?.document;
  const chapterCount = countItems(document?.chapters);
  const characterCount = countItems(document?.characters);
  const sceneCount = countItems(document?.scenes);
  const fragmentCount = (document?.chapters ?? []).reduce(
    (total, chapter) => total + (chapter.fragments?.length ?? 0),
    0,
  );
  const endingCount = (reportQuery.data?.chapters ?? []).reduce(
    (total, chapter) => total + chapter.ending_ids.length,
    0,
  );
  const loading =
    projectQuery.isLoading || storyQuery.isLoading || reportQuery.isLoading;
  const failed =
    projectQuery.isError || storyQuery.isError || reportQuery.isError;

  return (
    <section className="workshop-page galgame-overview-page">
      <button
        type="button"
        className="workshop-back-inline"
        onClick={onProjects}
      >
        <ArrowLeft aria-hidden />
        返回工程列表
      </button>
      <header className="galgame-overview-hero">
        <div>
          <span>PROJECT OVERVIEW</span>
          <h1>{project?.title ?? "工程概览"}</h1>
          <p>从故事结构进入角色、场景、分支试玩和确定性线路检查。</p>
          {project ? (
            <div className="galgame-overview-health">
              <span className={`workshop-status ${project.status}`}>
                {project.status === "draft" ? "草稿" : "已完成"}
              </span>
              <span className={reportQuery.data?.ready ? "ready" : "blocked"}>
                {reportQuery.data?.ready ? (
                  <CheckCircle2 aria-hidden />
                ) : (
                  <RefreshCcw aria-hidden />
                )}
                {reportQuery.data?.ready ? "线路就绪" : "仍需完善线路"}
              </span>
            </div>
          ) : null}
        </div>
        {project ? (
          <div className="galgame-overview-toolbar">
            <AmadeusButton
              source={{
                application: "Galgame 工坊",
                projectId,
                title: project.title,
              }}
            />
            <button
              type="button"
              className="galgame-overview-primary"
              onClick={onOpenEditor}
            >
              <BookOpenText aria-hidden /> 进入编辑器
            </button>
            <button
              type="button"
              disabled={
                patchMutation.isPending ||
                (project.status === "draft" && !reportQuery.data?.ready)
              }
              onClick={() =>
                patchMutation.mutate({
                  status: project.status === "draft" ? "completed" : "draft",
                })
              }
            >
              {project.status === "draft" ? "标记完成" : "恢复草稿"}
            </button>
          </div>
        ) : null}
      </header>
      {notice ? (
        <div className="workshop-notice" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="workshop-state">
          <LoadingState label="正在读取工程概览" variant="inline" />
        </div>
      ) : failed ? (
        <div className="workshop-state">
          <strong>工程概览暂时无法读取</strong>
          <button
            onClick={() => {
              void projectQuery.refetch();
              void storyQuery.refetch();
              void reportQuery.refetch();
            }}
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="galgame-overview-stats" aria-label="故事摘要">
            <div className="galgame-overview-stat">
              <strong>{chapterCount}</strong>
              <span>章节</span>
            </div>
            <div className="galgame-overview-stat">
              <strong>{characterCount}</strong>
              <span>角色</span>
            </div>
            <div className="galgame-overview-stat">
              <strong>{sceneCount}</strong>
              <span>场景</span>
            </div>
            <div className="galgame-overview-stat">
              <strong>{fragmentCount}</strong>
              <span>Fragment</span>
            </div>
            <div className="galgame-overview-stat">
              <strong>{endingCount}</strong>
              <span>结局</span>
            </div>
          </div>
          <div className="galgame-overview-modules" aria-label="模块入口">
            {MODULES.map((module) => {
              const Icon = module.icon;
              return (
                <button
                  key={module.id}
                  type="button"
                  className="galgame-overview-module"
                  onClick={onOpenEditor}
                >
                  <Icon aria-hidden />
                  <strong>{module.title}</strong>
                  <small>{module.description}</small>
                  <em>打开工作区</em>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
