import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { BookOpen } from "lucide-react";
import { useImagePreviewUrl } from "@platform/api/useImagePreviewUrl";
export function KnowledgeCover({
  assetId,
  imageOnly = false,
}: {
  assetId?: string | null;
  imageOnly?: boolean;
}) {
  const { ref, url, error } = useImagePreviewUrl(
    assetId ? `/v1/files/${encodeURIComponent(assetId)}/download` : null,
  );
  if (imageOnly) {
    return (
      <span ref={ref} className="knowledge-card-image">
        {url && <ResponsiveImage src={url} alt="" />}
      </span>
    );
  }
  return (
    <div ref={ref} className="knowledge-cover">
      {url ? (
        <ResponsiveImage src={url} alt="知识库封面" />
      ) : (
        <>
          <div className="knowledge-cover-orbit" />
          <BookOpen size={44} strokeWidth={1} />
          <span>{error ? "封面暂时无法读取" : "THOUGHT WORKSHOP"}</span>
        </>
      )}
    </div>
  );
}
