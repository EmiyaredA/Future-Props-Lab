import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { KnowledgeBase, NoteSummary } from "../api";
import { getDirectory } from "../knowledgeApi";
import { thoughtKeys } from "../queryKeys";
import { copySnapshot, duplicateDocument } from "./api";
export function CopyDialog({
  source,
  projects,
  close,
  created,
}: {
  source: NoteSummary;
  projects: KnowledgeBase[];
  close: () => void;
  created: (project: string, id: string) => void;
}) {
  const [subtree, setSubtree] = useState(false),
    [target, setTarget] = useState(source.knowledge_base_id),
    [parent, setParent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const snapshot = useQuery({
    queryKey: thoughtKeys.copySnapshot(source.id, subtree),
    queryFn: () => copySnapshot(source.id, subtree),
    retry: false,
  });
  const directory = useQuery({
    queryKey: thoughtKeys.directory(target),
    queryFn: ({ signal }) => getDirectory(target, signal),
    retry: false,
    staleTime: 0,
  });
  return (
    <ConfirmDialog
      open
      title={`复制「${source.title}」`}
      pending={busy}
      confirmDisabled={
        !snapshot.data ||
        !directory.data ||
        snapshot.isFetching ||
        directory.isFetching
      }
      confirmLabel="创建副本"
      onCancel={close}
      onConfirm={() =>
        void (async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            if (!snapshot.data || !directory.data)
              throw new Error("请等待复制信息加载完成");
            const result = await duplicateDocument(source.id, {
              knowledge_base_id: target,
              parent_id: parent || null,
              subtree,
              source_knowledge_revision: snapshot.data.knowledge_revision,
              expected_knowledge_revision:
                directory.data.knowledge_base.revision,
              expected_revisions: snapshot.data.revisions,
            });
            created(result.knowledge_base_id, result.root_id);
            close();
          } catch (error) {
            setError(error instanceof Error ? error.message : "复制失败");
          } finally {
            setBusy(false);
          }
        })()
      }
      description={
        <div className="thought-tools">
          {(snapshot.isPending || directory.isPending) && (
            <LoadingState label="正在读取复制信息…" variant="region" />
          )}
          <button
            className="btn"
            aria-pressed={subtree}
            onClick={() => setSubtree(!subtree)}
          >
            {subtree ? "包含子文档" : "仅当前文档"}
          </button>
          <CustomSelect
            ariaLabel="副本目标知识库"
            value={target}
            options={projects
              .filter((p) => !p.deleted_at)
              .map((p) => ({ value: p.id, label: p.title }))}
            onChange={(id) => {
              setTarget(id);
              setParent("");
            }}
          />
          <CustomSelect
            ariaLabel="副本目标父文档"
            value={parent}
            options={[
              { value: "", label: "知识库根目录" },
              ...(directory.data?.documents ?? []).map((n) => ({
                value: n.id,
                label: n.title,
              })),
            ]}
            onChange={setParent}
          />
          {snapshot.data && (
            <p>
              复制 {Object.keys(snapshot.data.revisions).length}{" "}
              篇文档，副本独立编辑。
            </p>
          )}
          {(error || snapshot.error || directory.error) && (
            <p role="alert">
              {error || snapshot.error?.message || directory.error?.message}
              <button
                className="btn"
                onClick={() => {
                  void snapshot.refetch();
                  void directory.refetch();
                  setError("");
                }}
              >
                刷新复制信息
              </button>
            </p>
          )}
        </div>
      }
    />
  );
}
