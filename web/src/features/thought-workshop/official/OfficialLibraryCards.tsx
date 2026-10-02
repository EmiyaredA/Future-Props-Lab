import { BookOpen, LockKeyhole } from "lucide-react";
import { ProjectLibraryCard } from "@shared/ui/project-library/ProjectLibraryCard";
import { filterOfficialLibraries } from "./catalog";
import "../knowledge.css";
import "./official.css";

export function OfficialLibraryCards({
  query = "",
  onOpen,
}: {
  query?: string;
  onOpen: (libraryId: string) => void;
}) {
  const libraries = filterOfficialLibraries(query);
  return (
    <section className="official-library-section" aria-label="官方文档">
      <header className="official-section-heading">
        <h2>官方文档</h2>
        <p>内置使用指南 · 随应用版本更新</p>
      </header>
      <div className="knowledge-cards">
        {libraries.map((library) => (
          <ProjectLibraryCard
            key={library.id}
            project={library}
            cover="canvas"
            coverTitle={library.title}
            coverDescription=""
            coverContent={
              <div className="knowledge-cover official-cover">
                <BookOpen size={42} aria-hidden />
                <span>OFFICIAL GUIDE</span>
              </div>
            }
            metadata={
              <>
                <span className="official-badge">
                  <LockKeyhole size={13} aria-hidden />
                  官方 · 只读
                </span>
                <span>{library.documents.length} 篇文档</span>
              </>
            }
            description={library.description}
            onOpen={() => onOpen(library.id)}
          >
            <button className="btn" onClick={() => onOpen(library.id)}>
              进入知识库
            </button>
          </ProjectLibraryCard>
        ))}
      </div>
      {!libraries.length && <p role="status">没有匹配的官方知识库。</p>}
    </section>
  );
}
