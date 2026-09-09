import { ReadOnlyAssetList } from "@shared/ui/ReadOnlyAssetList";
import { useQuery } from "@tanstack/react-query";
import { ReadOnlyCollection, ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { listVideoEditorProjects } from "./api";
import { videoEditorQueryKeys } from "./queryKeys";
import { useVideoEditor } from "./useVideoEditor";
import { VideoEditorPreview } from "./VideoEditorPreview";
import "./video-editor.css";
import "./video-editor-workspace.css";
export function ReadOnlyVideo({
  projectId,
  onOpen,
  onBack,
}: {
  projectId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const projects = useQuery({
    queryKey: videoEditorQueryKeys.projects,
    queryFn: listVideoEditorProjects,
    enabled: !projectId,
  });
  if (projectId)
    return <ReadOnlyTimeline projectId={projectId} onBack={onBack} />;
  return (
    <ReadOnlyPage
      title="视频剪辑"
      error={projects.error}
      loading={projects.isPending}
    >
      <ReadOnlyCollection items={projects.data?.items || []} onOpen={onOpen} />
    </ReadOnlyPage>
  );
}
function ReadOnlyTimeline({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const editor = useVideoEditor(projectId);
  return (
    <ReadOnlyPage
      title={editor.project.data?.title || "视频剪辑"}
      onBack={onBack}
      loading={editor.timeline.isPending}
      error={
        editor.project.error || editor.timeline.error || editor.assets.error
      }
    >
      {editor.timeline.data ? (
        <>
          <VideoEditorPreview
            projectId={projectId}
            projectTitle={editor.project.data?.title}
            timeline={editor.timeline.data}
            assets={editor.assets.data?.items || []}
            playheadUs={editor.playheadUs}
            setPlayheadUs={editor.setPlayheadUs}
            playing={editor.playing}
            setPlaying={editor.setPlaying}
            preciseFrame={editor.preciseFrame}
            onPreciseFrameChange={editor.setPreciseFrame}
          />
          <label>
            播放位置
            <input
              className="readonly-timeline"
              type="range"
              min={0}
              max={Math.max(1, editor.durationUs)}
              step={1000}
              value={editor.playheadUs}
              onChange={(e) => editor.setPlayheadUs(Number(e.target.value))}
            />
          </label>
          <ReadOnlyAssetList
            items={
              editor.assets.data?.items.map((asset) => ({
                id: asset.id,
                name: asset.displayName || asset.originalFilename,
                kind: asset.mediaKind,
                path: `/v1/files/${asset.id}/content`,
              })) || []
            }
          />
          {editor.timeline.data.document.tracks?.map((track) => (
            <article key={track.id}>
              <h2>{track.name}</h2>
              {track.clips?.map((clip) => (
                <button
                  className="btn small"
                  key={clip.id}
                  onClick={() => editor.setPlayheadUs(clip.timelineStartUs)}
                >
                  {clip.name} · {(clip.timelineStartUs / 1000000).toFixed(1)} 秒
                </button>
              ))}
            </article>
          ))}
        </>
      ) : null}
    </ReadOnlyPage>
  );
}
