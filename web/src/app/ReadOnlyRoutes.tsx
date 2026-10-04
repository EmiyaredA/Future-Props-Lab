import { lazy } from "react";
import type { AppPage, AppRoute } from "./routes";
const Files = lazy(() =>
  import("@features/files/ReadOnlyFiles").then((m) => ({
    default: m.ReadOnlyFiles,
  })),
);
const Visual = lazy(() =>
  import("@features/visual-workshop/ReadOnlyVisual").then((m) => ({
    default: m.ReadOnlyVisual,
  })),
);
const Thought = lazy(() =>
  import("@features/thought-workshop/ThoughtReadOnlyPage").then((m) => ({
    default: m.ThoughtReadOnlyPage,
  })),
);
const Galgame = lazy(() =>
  import("@features/galgame-workshop/ReadOnlyGalgame").then((m) => ({
    default: m.ReadOnlyGalgame,
  })),
);
const Video = lazy(() =>
  import("@features/video-editor/ReadOnlyVideo").then((m) => ({
    default: m.ReadOnlyVideo,
  })),
);
const Audio = lazy(() =>
  import("@features/audio-annotation/ReadOnlyAnnotation").then((m) => ({
    default: m.ReadOnlyAnnotation,
  })),
);
const Models = lazy(() =>
  import("@features/models/ReadOnlyModels").then((m) => ({
    default: m.ReadOnlyModels,
  })),
);
const VisualTasks = lazy(() =>
  import("@features/visual-workshop/generation/VisualWorkshopTasksPage").then(
    (m) => ({ default: m.VisualWorkshopTasksPage }),
  ),
);
const VideoTasks = lazy(() =>
  import("@features/video-editor/VideoEditorTasksPage").then((m) => ({
    default: m.VideoEditorTasksPage,
  })),
);
export function ReadOnlyRoutes({
  route,
  navigate,
}: {
  route: AppRoute;
  navigate: (page: AppPage, id?: string, documentId?: string) => void;
}) {
  const { page, projectId, documentId } = route;
  if (page === "files") return <Files />;
  if (page === "visual-workshop-assets") return <Files projectId={projectId} />;
  if (page === "visual-workshop-tasks")
    return (
      <VisualTasks
        onOpenProject={(id) => navigate("visual-workshop-canvas", id)}
        onOpenAssets={(id) => navigate("visual-workshop-assets", id)}
      />
    );
  if (page.startsWith("visual-workshop-"))
    return (
      <>
        <div className="readonly-page button-row">
          <button
            className="btn"
            onClick={() => navigate("visual-workshop-tasks")}
          >
            已有生成任务
          </button>
          {projectId ? (
            <button
              className="btn"
              onClick={() => navigate("visual-workshop-assets", projectId)}
            >
              项目素材
            </button>
          ) : null}
        </div>
        <Visual
          projectId={projectId}
          onOpen={(id) => navigate("visual-workshop-canvas", id)}
          onBack={() => navigate("visual-workshop-projects")}
        />
      </>
    );
  if (page.startsWith("thought-workshop-"))
    return (
      <Thought
        projectId={projectId}
        documentId={documentId}
        onNavigateSection={(section) =>
          navigate(
            section === "private"
              ? "thought-workshop-notes"
              : section === "favorites"
                ? "thought-workshop-favorites"
                : section === "published"
                  ? "thought-workshop-published"
                  : "thought-workshop-community",
          )
        }
        onOpenOfficial={(id) => navigate("thought-workshop-official", id)}
        onOpen={(id, doc) =>
          navigate(
            id ? "thought-workshop-editor" : "thought-workshop-notes",
            id,
            doc,
          )
        }
      />
    );
  if (page.startsWith("galgame-workshop-"))
    return (
      <Galgame
        projectId={projectId}
        onOpen={(id) => navigate("galgame-workshop-overview", id)}
        onBack={() => navigate("galgame-workshop-projects")}
      />
    );
  if (page === "video-editor-tasks")
    return (
      <VideoTasks onOpenProject={(id) => navigate("video-editor-editor", id)} />
    );
  if (page.startsWith("video-editor-"))
    return (
      <>
        <div className="readonly-page">
          <button
            className="btn"
            onClick={() => navigate("video-editor-tasks")}
          >
            已有渲染与导出
          </button>
        </div>
        <Video
          projectId={projectId}
          onOpen={(id) => navigate("video-editor-editor", id)}
          onBack={() => navigate("video-editor-projects")}
        />
      </>
    );
  if (page.startsWith("audio-annotation-"))
    return (
      <Audio
        projectId={projectId}
        onOpen={(id) => navigate("audio-annotation-editor", id)}
        onBack={() => navigate("audio-annotation-projects")}
      />
    );
  return <Models />;
}
