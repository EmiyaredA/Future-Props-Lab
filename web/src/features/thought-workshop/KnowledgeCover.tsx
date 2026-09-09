import { BookOpen } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
export function KnowledgeCover({ assetId }: { assetId?: string | null }) {
  const { url, error } = useApiBlobUrl(
    assetId ? `/v1/files/${encodeURIComponent(assetId)}/download` : null,
  );
  return (
    <div className="knowledge-cover">
      {url ? (
        <img src={url} alt="知识库封面" />
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
