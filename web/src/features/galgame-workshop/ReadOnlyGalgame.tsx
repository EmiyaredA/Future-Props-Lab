import type { ReactNode } from "react";
import { ReadOnlyAssetList } from "@shared/ui/ReadOnlyAssetList";
import { useQuery } from "@tanstack/react-query";
import {
  ReadOnlyCollection,
  ReadOnlyPage,
  ReadOnlyWorkshopLibrary,
} from "@shared/ui/ReadOnlyPage";
import {
  getGalgameWorkshopProjects,
  getGalgameProjectAssets,
  getGalgameWorkshopProject,
  getGalgameStoryDocument,
} from "./api";
import { galgameQueryKeys } from "./queryKeys";
import { StoryPlayer } from "./editor/StoryPlayer";
import "./styles/assets-and-player.css";
export function ReadOnlyGalgame({
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
    queryKey: galgameQueryKeys.projects,
    queryFn: getGalgameWorkshopProjects,
    enabled: !projectId,
  });
  const project = useQuery({
    queryKey: galgameQueryKeys.project(projectId || ""),
    queryFn: () => getGalgameWorkshopProject(projectId!),
    enabled: !!projectId,
  });
  const assets = useQuery({
    queryKey: galgameQueryKeys.projectAssets(projectId || ""),
    queryFn: () => getGalgameProjectAssets(projectId!),
    enabled: !!projectId,
  });
  const story = useQuery({
    queryKey: galgameQueryKeys.story(projectId || ""),
    queryFn: () => getGalgameStoryDocument(projectId!),
    enabled: !!projectId,
  });
  if (!projectId && utilities) {
    return (
      <ReadOnlyWorkshopLibrary
        title="我的 Galgame 工程"
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
      title={project.data?.title || "Galgame 工坊"}
      error={projects.error || story.error}
      loading={projectId ? story.isPending : projects.isPending}
      onBack={projectId ? onBack : undefined}
    >
      {!projectId ? (
        <ReadOnlyCollection
          items={projects.data?.items || []}
          onOpen={onOpen}
        />
      ) : story.data ? (
        <>
          <StoryPlayer
            key={projectId}
            document={story.data.document}
            mode="play"
          />
          {story.data.document.chapters?.map((chapter) => (
            <article key={chapter.id}>
              <h2>{chapter.title}</h2>
              {chapter.fragments?.map((fragment) => (
                <details key={fragment.id}>
                  <summary>{fragment.title}</summary>
                  {fragment.blocks?.map((block) => (
                    <p key={block.id}>
                      {block.type === "dialogue"
                        ? block.text
                        : block.type === "narration"
                          ? block.text
                          : ""}
                    </p>
                  ))}
                </details>
              ))}
            </article>
          ))}
        </>
      ) : null}
      {projectId ? (
        <ReadOnlyAssetList
          items={
            assets.data?.items.map((asset) => ({
              id: asset.id,
              name: asset.display_name,
              kind: asset.media_kind,
              path: `/v1/files/${asset.id}/content`,
            })) || []
          }
        />
      ) : null}
    </ReadOnlyPage>
  );
}
