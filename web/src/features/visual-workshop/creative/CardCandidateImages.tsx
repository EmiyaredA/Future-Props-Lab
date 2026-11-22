import { Check } from "lucide-react";
import { ImagePreview } from "@shared/ui/ImagePreview";

export function CardCandidateImages({
  ids,
  adoptedId,
  readOnly,
  busy,
  onAdopt,
}: {
  ids: string[];
  adoptedId?: string | null;
  readOnly: boolean;
  busy: boolean;
  onAdopt: (id: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <section className="card-editor-candidate-section" aria-label="候选图">
      <div className="card-editor-media-heading">
        <h3>
          候选图 <span className="card-editor-count">{ids.length}</span>
        </h3>
        <span className="card-editor-caption">选择最符合设定的一张</span>
      </div>
      <div className="card-editor-candidates">
        {ids.map((id, index) => (
          <div
            key={id}
            className="card-editor-candidate"
            data-adopted={id === adoptedId}
          >
            <ImagePreview
              interactive={false}
              size={320}
              alt={`候选图 ${index + 1}`}
              src={`/v1/files/${id}/content`}
            />
            {id === adoptedId ? (
              <span className="card-editor-selected" role="status">
                <Check size={13} aria-hidden /> 已选中
              </span>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  className="creative-quiet"
                  aria-label={`采用候选图 ${index + 1}`}
                  disabled={busy}
                  onClick={() => onAdopt(id)}
                >
                  采用此图
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
