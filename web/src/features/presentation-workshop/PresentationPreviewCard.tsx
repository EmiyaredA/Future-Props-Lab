import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Eye } from "lucide-react";
import { getProject } from "./api";
import { presentationKeys } from "./queryKeys";
import { SlidePreview } from "./SlideSurface";
import { PresentationPreviewDialog } from "./PresentationPreviewDialog";
import type { Slide } from "./types";
import "./presentation-preview.css";

type PreviewSource =
  | { slides: Slide[]; projectId?: never; slideCount?: never }
  | { projectId: string; slideCount: number; slides?: never };

export function PresentationPreviewCard({
  title,
  firstSlide,
  projectId,
  slideCount,
  slides,
  actionLabel,
  onUse,
  disabled = false,
  className,
}: PreviewSource & {
  title: string;
  firstSlide: Slide;
  actionLabel: string;
  onUse: () => void;
  disabled?: boolean;
  className: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const used = useRef(false);
  const restoringFocus = useRef(false);
  const project = useQuery({
    queryKey: presentationKeys.project(projectId ?? ""),
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: !!projectId && (hovered || open),
    subscribed: !!projectId && (hovered || open),
    staleTime: 10_000,
    retry: false,
  });
  const pages = slides ?? project.data?.document.slides;
  const total = pages?.length ?? slideCount ?? 1;
  const failed = !!projectId && project.isError;
  const loading = !!projectId && !pages && !failed;
  return (
    <>
      <Tooltip.Provider delayDuration={350} disableHoverableContent>
        <Tooltip.Root
          open={hovered && !open && !disabled}
          onOpenChange={(next) => {
            if (!restoringFocus.current) setHovered(next);
          }}
        >
          <Tooltip.Trigger asChild>
            <button
              ref={trigger}
              className={className}
              aria-label={`预览 ${title}`}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => {
                setHovered(false);
                setOpen(true);
              }}
            >
              <div className="presentation-starter-preview">
                <SlidePreview slide={firstSlide} />
                <span className="presentation-preview-hint">
                  <Eye size={16} aria-hidden /> 预览
                </span>
              </div>
              {slides && <span>{title}</span>}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="presentation-hover-preview"
              data-page-count={Math.min(total, 3)}
              side="bottom"
              sideOffset={10}
              collisionPadding={16}
              aria-label={`${title}，共 ${total} 页，点击查看完整预览`}
            >
              <div className="presentation-hover-heading">
                <strong>{title}</strong>
                <span>{total} 页 · 点击查看完整预览</span>
              </div>
              {failed ? (
                <p role="status">预览加载失败，点击卡片后可重试。</p>
              ) : loading ? (
                <p role="status">正在加载预览…</p>
              ) : null}
              <div className="presentation-hover-pages">
                {(pages ?? [firstSlide]).slice(0, 3).map((slide, index) => (
                  <figure key={slide.id}>
                    <SlidePreview slide={slide} />
                    <figcaption>第 {index + 1} 页</figcaption>
                  </figure>
                ))}
              </div>
              <Tooltip.Arrow className="presentation-hover-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      {open && (
        <PresentationPreviewDialog
          title={title}
          slides={pages}
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
            restoringFocus.current = true;
            if (!used.current) trigger.current?.focus();
            restoringFocus.current = false;
            used.current = false;
          }}
        />
      )}
    </>
  );
}
