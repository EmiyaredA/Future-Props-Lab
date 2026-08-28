import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

export function StoryPlayerImageWarmup({ fileIds }: { fileIds: string[] }) {
  return (
    <span className="galgame-player-image-warmup" aria-hidden>
      {fileIds.map((fileId) => (
        <StoryAssetImage key={fileId} fileId={fileId} alt="" fallback={null} />
      ))}
    </span>
  );
}
