import type { ReactNode } from "react";
import {
  ProjectCoverPreview,
  type ProjectPreview,
  type PreviewRenderer,
} from "./ProjectCoverPreview";
import { relativeTime } from "@shared/lib/date";

export type ProjectLibraryItem = {
  id: string;
  title: string;
  updated_at?: string;
  preview?: ProjectPreview | null;
};

export function ProjectLibraryCard({
  project,
  cover,
  coverTitle,
  coverDescription,
  onOpen,
  children,
  coverContent,
  metadata,
  description,
  renderPreview,
}: {
  renderPreview?: PreviewRenderer;
  coverContent?: ReactNode;
  metadata?: ReactNode;
  description?: string;
  project: ProjectLibraryItem;
  cover: "canvas" | "galgame" | "video" | "audio" | "director" | "knowledge";
  coverTitle: string;
  coverDescription?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <article className="workshop-project-card">
      <button
        className={`workshop-project-cover ${cover}`}
        onClick={onOpen}
        aria-label={`打开 ${project.title}`}
      >
        {coverContent ??
          (project.preview && (
            <ProjectCoverPreview
              namespace={cover}
              projectId={project.id}
              title={project.title}
              preview={project.preview}
              render={renderPreview}
            />
          ))}
        <span className="workshop-project-cover-content">
          <span className="workshop-project-cover-label">
            <strong>{coverTitle}</strong>
            {coverDescription && <small>{coverDescription}</small>}
          </span>
        </span>
      </button>
      <div className="workshop-project-copy">
        <div className="workshop-project-meta">
          {metadata}
          {project.updated_at && (
            <small>{relativeTime(project.updated_at)}</small>
          )}
        </div>
        <h2>{project.title}</h2>
        {description && <p>{description}</p>}
        <div className="workshop-project-actions">{children}</div>
      </div>
    </article>
  );
}
