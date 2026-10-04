import "../thought-workshop.css";
import "../knowledge.css";
import "./community.css";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccountId } from "@platform/auth/WorkspacePermissions";
import { thoughtKeys } from "../queryKeys";
import { resolveOfficialLink } from "./api";
export function LegacyOfficialPage({
  libraryId,
  documentId,
  onOpen,
  onBack,
}: {
  libraryId?: string;
  documentId?: string;
  onOpen: (publication: string, note: string) => void;
  onBack: () => void;
}) {
  const user = useAccountId() ?? "";
  const targets = useQuery({
    queryKey: thoughtKeys.officialLink(user, libraryId ?? "", documentId ?? ""),
    queryFn: () => resolveOfficialLink(libraryId ?? "", documentId),
    enabled: !!libraryId,
    retry: false,
  });
  const only = targets.data?.length === 1 ? targets.data[0] : undefined;
  useEffect(() => {
    if (only) onOpen(only.publication.id, only.note_id);
  }, [only, onOpen]);
  return (
    <main className="knowledge-main">
      <header className="knowledge-topbar">
        <h1>官方文档</h1>
        <button className="btn" onClick={onBack}>
          返回知识社区
        </button>
      </header>
      <section className="community-content">
        {targets.isPending && libraryId && (
          <p role="status">正在查找已发布文档…</p>
        )}
        {targets.isError && (
          <p role="alert">
            {targets.error.message}
            <button className="btn" onClick={() => void targets.refetch()}>
              重试
            </button>
          </p>
        )}
        {targets.isSuccess && !targets.data.length && (
          <p role="status">
            此文档尚未导入并发布，或您没有访问权限。管理员可从知识社区主动导入现有文档。
          </p>
        )}
        {targets.data && targets.data.length > 1 && (
          <>
            <p>请选择要阅读的官方发布：</p>
            {targets.data.map((target) => (
              <a
                href={`/apps/thought-workshop/community/${target.publication.id}/documents/${target.note_id}`}
                key={target.note_id}
                className="btn"
                onClick={(event) => {
                  if (
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onOpen(target.publication.id, target.note_id);
                  }
                }}
              >
                {target.publication.title} · {target.publication.author}
              </a>
            ))}
          </>
        )}
      </section>
    </main>
  );
}
