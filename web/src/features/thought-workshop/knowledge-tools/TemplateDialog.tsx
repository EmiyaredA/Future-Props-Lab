import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { RichEditor } from "../RichEditor";
import { NoteTags } from "../NoteTags";
import type { KnowledgeBase, Note } from "../api";
import { getDirectory } from "../knowledgeApi";
import { thoughtKeys } from "../queryKeys";
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
  const [selected, setSelected] = useState<Template | null>(null),
    [draft, setDraft] = useState<{
      name: string;
      description: string;
      document: Note["document"];
      tags: string[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [nameInput, setNameInput] = useState(false);
  const choose = (template: Template) => {
    setSelected(template);
    setDraft({
      name: template.name,
      description: template.description ?? "",
      document: structuredClone(template.document),
      tags: template.tags ?? [],
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
              value={selected?.id ?? ""}
              options={[
                { value: "", label: "选择模板" },
                ...(templates.data ?? []).map((t) => ({
                  value: t.id,
                  label: t.name,
                })),
              ]}
              onChange={(id) => {
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
          {selected && draft && (
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
              <RichEditor
                key={selected.id}
                document={draft.document}
                onChange={(document) => setDraft({ ...draft, document })}
                onReady={() => {}}
              />
              <div className="thought-tools">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const updated = await updateTemplate(selected, draft);
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
                      await deleteTemplate(selected);
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
                const template = await saveTemplate({
                  name,
                  description: "",
                  document: current.document,
                  tags: current.tags,
                  schema_version: 3,
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
