import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { getProject } from "./api";
import { presentationKeys } from "./queryKeys";
import { SlidePreview } from "./SlideSurface";
import { PresentationPreviewDialog } from "./PresentationPreviewDialog";
import type { PageSize, Slide } from "./types";
import "./presentation-preview.css";

type PreviewSource =
  | { slides: Slide[]; projectId?: never }
  | { projectId: string; slides?: never };

export function PresentationPreviewCard({
  title,
  firstSlide,
  projectId,
  slides,
  actionLabel,
  onUse,
  disabled = false,
  className,
  size,
}: PreviewSource & {
  size?: PageSize;
  title: string;
  firstSlide: Slide;
  actionLabel: string;
  onUse: () => void;
  disabled?: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const used = useRef(false);
  const project = useQuery({
    queryKey: presentationKeys.project(projectId ?? ""),
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: !!projectId && open,
    subscribed: !!projectId && open,
    staleTime: 10_000,
    retry: false,
  });
  const pages = slides ?? project.data?.document.slides;
  const failed = !!projectId && project.isError;
  const loading = !!projectId && !pages && !failed;
  return (
    <>
      {projectId ? (
        <div className="presentation-project-cover">
          <button
            className={className}
            aria-label={`打开 ${title}（封面）`}
            disabled={disabled}
            onClick={onUse}
          >
            <div className="presentation-starter-preview">
              <SlidePreview slide={firstSlide} size={size} />
            </div>
          </button>
          <button
            ref={trigger}
            className="presentation-preview-hint presentation-project-preview"
            aria-label={`预览 ${title}`}
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            <Eye size={16} aria-hidden /> 预览
          </button>
        </div>
      ) : (
        <button
          ref={trigger}
          className={className}
          aria-label={`预览 ${title}`}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <div className="presentation-starter-preview">
            <SlidePreview slide={firstSlide} size={size} />
            <span className="presentation-preview-hint">
              <Eye size={16} aria-hidden /> 预览
            </span>
          </div>
          <span>{title}</span>
        </button>
      )}
      {open && (
        <PresentationPreviewDialog
          title={title}
          slides={pages}
          size={project.data?.document ?? size}
          loading={loading}
          failed={failed}
          retry={() => void project.refetch()}
          actionLabel={actionLabel}
          onUse={() => {
            used.current = true;
            setOpen(false);
            onUse();
          }}
          onClose={() => setOpen(false)}
          returnFocus={() => {
            if (!used.current) trigger.current?.focus();
            used.current = false;
          }}
        />
      )}
    </>
  );
}
