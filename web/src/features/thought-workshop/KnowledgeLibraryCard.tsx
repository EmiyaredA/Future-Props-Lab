import {
  BookOpen,
  Download,
  Image,
  Info,
  Maximize2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { ProjectLibraryCard } from "@shared/ui/project-library/ProjectLibraryCard";
import { KnowledgeActionMenu, type TopbarAction } from "./KnowledgeActionMenu";
import { KnowledgeCover } from "./KnowledgeCover";
import type { KnowledgeBase } from "./api";
import "./knowledge-library-card.css";

const moreActions: TopbarAction[][] = [
  [
    { value: "description", label: "修改简介", icon: Info },
    { value: "cover", label: "更换封面", icon: Image },
    { value: "clear-cover", label: "恢复默认封面", icon: RotateCcw },
  ],
];

export function KnowledgeLibraryCard({
  project,
  onOpen,
  onAction,
}: {
  project: KnowledgeBase;
  onOpen: () => void;
  onAction: (value: string) => void;
}) {
  const { cover_asset_id, description, document_count, title } = project;

  return (
    <ProjectLibraryCard
      project={project}
      cover="knowledge"
      coverTitle="知识库"
      coverContent={<KnowledgeCover assetId={cover_asset_id} imageOnly />}
      metadata={
        <span className="knowledge-card-count">
          <BookOpen size={12} aria-hidden="true" />
          {document_count} 篇文档
        </span>
      }
      description={description}
      onOpen={onOpen}
    >
      <div className="workshop-project-primary-actions">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`打开知识库：${title}`}
        >
          <Maximize2 aria-hidden="true" />
          打开
        </button>
      </div>
      <div className="workshop-project-secondary-actions">
        <button
          type="button"
          aria-label={`导出 ${title}`}
          title="导出知识库"
          onClick={() => onAction("export")}
        >
          <Download aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`重命名 ${title}`}
          title="重命名"
          onClick={() => onAction("rename")}
        >
          <Pencil aria-hidden="true" />
        </button>
        <KnowledgeActionMenu
          ariaLabel={`${title}更多操作`}
          groups={moreActions}
          onAction={onAction}
        />
        <button
          type="button"
          className="danger"
          aria-label={`将 ${title} 移入回收站`}
          title="移入回收站"
          onClick={() => onAction("trash")}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </ProjectLibraryCard>
  );
}
