import type { ReactNode } from "react";
import { relativeTime } from "@shared/lib/date";

export type ProjectLibraryItem = {
  id: string;
  title: string;
  status: "draft" | "completed";
  updated_at: string;
};

export function ProjectLibraryCard({
  project,
  cover,
  coverTitle,
  coverDescription,
  onOpen,
  children,
}: {
  project: ProjectLibraryItem;
  cover: "canvas" | "galgame" | "video";
  coverTitle: string;
  coverDescription: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <article className="workshop-project-card">
      <button className={`workshop-project-cover ${cover}`} onClick={onOpen}>
        <span className="workshop-project-cover-content">
          <span className="workshop-project-cover-label">
            <strong>{coverTitle}</strong>
            <small>{coverDescription}</small>
          </span>
        </span>
      </button>
      <div className="workshop-project-copy">
        <div className="workshop-project-meta">
          <span className={`workshop-status ${project.status}`}>
            {project.status === "draft" ? "草稿" : "已完成"}
          </span>
          <small>{relativeTime(project.updated_at)}</small>
        </div>
        <h2>{project.title}</h2>
        <div className="workshop-project-actions">{children}</div>
      </div>
    </article>
  );
}
