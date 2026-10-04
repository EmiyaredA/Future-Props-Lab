import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { RichEditor } from "../RichEditor";
import { NoteTags } from "../NoteTags";
import { createNote, type KnowledgeBase, type Note } from "../api";
import { homeTemplate } from "../document-layout/model";
import { getDirectory } from "../knowledgeApi";
import { thoughtKeys } from "../queryKeys";
import { historySnapshot } from "../multitable/api";
import { getNote } from "../api";
import {
  applyTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  updateTemplate,
  type Template,
} from "./api";

export function TemplateDialog({
  project,
  note,
  save,
  close,
  created,
}: {
  project: KnowledgeBase;
  note?: Note;
  save?: () => Promise<Note>;
  close: () => void;
  created: (id: string) => void;
}) {
  const client = useQueryClient(),
    templates = useQuery({
      queryKey: thoughtKeys.templates(),
      queryFn: listTemplates,
      retry: false,
    });
  const [builtin, setBuiltin] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null),
    [draft, setDraft] = useState<{
      name: string;
      description: string;
      document: Note["document"];
      tags: string[];
      kind?: Template["kind"];
      multitable?: Template["multitable"];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [nameInput, setNameInput] = useState(false);
  const choose = (template: Template) => {
    setBuiltin(false);
    setSelected(template);
    setDraft({
      name: template.name,
      description: template.description ?? "",
      document: structuredClone(template.document),
      tags: template.tags ?? [],
      kind: template.kind,
      multitable: template.multitable,
    });
  };
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await client.invalidateQueries({ queryKey: thoughtKeys.templates() });
    } catch (error) {
      setError(error instanceof Error ? error.message : "模板操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open
      title="Workspace 文档模板"
      pending={busy}
      confirmLabel="从模板创建文档"
      onCancel={close}
      onConfirm={() =>
        void run(async () => {
          if (builtin && draft) {
            const n = await createNote({
              title: draft.name,
              knowledge_base_id: project.id,
              parent_id: null,
              schema_version: 3,
              document: draft.document,
              tags: draft.tags,
              pinned: false,
              favorite: false,
            });
            created(n.id);
            close();
            return;
          }
          if (!selected) throw new Error("请先选择模板");
          const latest = (await getDirectory(project.id)).knowledge_base;
          const createdNote = await applyTemplate(selected, {
            knowledge_base_id: project.id,
            title: selected.name,
            expected_knowledge_revision: latest.revision,
            parent_id: null,
          });
          created(createdNote.id);
          close();
        })
      }
      description={
        <div>
          {error && <p role="alert">{error}</p>}
          {templates.isError && (
            <p role="alert">
              {templates.error.message}
              <button className="btn" onClick={() => void templates.refetch()}>
                重试
              </button>
            </p>
          )}
          <div className="thought-tools">
            <CustomSelect
              ariaLabel="选择文档模板"
              value={builtin ? "builtin-home" : (selected?.id ?? "")}
              options={[
                { value: "", label: "选择模板" },
                { value: "builtin-home", label: "知识库首页（内置）" },
                ...(templates.data ?? []).map((t) => ({
                  value: t.id,
                  label: t.name,
                })),
              ]}
              onChange={(id) => {
                if (id === "builtin-home") {
                  setSelected(null);
                  setBuiltin(true);
                  setDraft({
                    name: "知识库首页",
                    description: "引导卡片、章节说明、卡片组与动态目录",
                    document: homeTemplate(),
                    tags: [],
                  });
                  return;
                }

                const t = templates.data?.find((t) => t.id === id);
                if (t) choose(t);
              }}
            />
            {note && (
              <button className="btn" onClick={() => setNameInput(true)}>
                将当前文档存为模板
              </button>
            )}
          </div>
          {(selected || builtin) && draft && (
            <>
              <div className="thought-tools">
                <input
                  aria-label="模板名称"
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <input
                  aria-label="模板说明"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </div>
              <NoteTags
                tags={draft.tags}
                onChange={(tags) => setDraft({ ...draft, tags })}
              />
              {draft.kind === "multitable" ? (
                <p>
                  多维表格快照：
                  {draft.multitable?.tables
                    .map(
                      (t) =>
                        `${t.name}（${draft.multitable?.records[t.id]?.length ?? 0} 条记录）`,
                    )
                    .join("、")}
                  。从模板创建后可编辑字段和视图。
                </p>
              ) : (
                <RichEditor
                  key={selected?.id ?? "builtin-home"}
                  libraryId={project.id}
                  document={draft.document}
                  onChange={(document) => setDraft({ ...draft, document })}
                  onReady={() => {}}
                />
              )}
              <div className="thought-tools">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const updated = selected
                        ? await updateTemplate(selected, draft)
                        : await saveTemplate({ ...draft, schema_version: 3 });
                      choose(updated);
                    })
                  }
                >
                  保存模板
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (selected) await deleteTemplate(selected);
                      setBuiltin(false);
                      setSelected(null);
                      setDraft(null);
                    })
                  }
                >
                  删除模板
                </button>
              </div>
            </>
          )}
          <TextInputDialog
            open={nameInput}
            title="保存文档模板"
            label="模板名称"
            initialValue={note?.title}
            onCancel={() => setNameInput(false)}
            onConfirm={(name) => {
              setNameInput(false);
              void run(async () => {
                const current = save ? await save() : note;
                if (!current) throw new Error("文档不可用");
                const latest =
                  current.kind === "multitable"
                    ? await getNote(current.id)
                    : current;
                const multitable =
                  latest.kind === "multitable"
                    ? await historySnapshot(latest.id, latest.revision)
                    : null;
                const template = await saveTemplate({
                  name,
                  description: "",
                  document: current.document,
                  tags: current.tags,
                  schema_version: 3,
                  kind: latest.kind ?? "note",
                  multitable,
                });
                choose(template);
              });
            }}
          />
        </div>
      }
    />
  );
}
