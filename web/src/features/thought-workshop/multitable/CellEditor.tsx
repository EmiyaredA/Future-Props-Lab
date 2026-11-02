import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { useDocumentAccess } from "../DocumentAccess";
import { thoughtKeys } from "../queryKeys";
import {
  communityAssetUrl,
  uploadCommunityFile,
  getCommunityDirectory,
} from "../community/api";
import type { Field, RecordRow, Scope } from "./api";
import { display, parseCell } from "./model";
import { FieldValue } from "./FieldValue";
import { PersonChoices } from "./PersonField";
import type { People } from "./formatting";
import { Modal } from "./Modal";

type Value = RecordRow["values"][string];
function AttachmentLink({ id, url }: { id: string; url: string }) {
  const preview = useApiBlobUrl(url);
  return (
    <a href={preview.url ?? undefined} download aria-disabled={!preview.url}>
      {id.slice(0, 8)}
      {preview.error ? "（不可访问）" : ""}
    </a>
  );
}
export function CellEditor({
  field,
  value,
  change,
  readOnly,
  scope,
  noteId,
  people = {},
}: {
  field: Field;
  value: Value | undefined;
  change: (v: Value) => void;
  readOnly: boolean;
  scope: Scope;
  people?: People;
  noteId: string;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const access = useDocumentAccess(),
    [edit, setEdit] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const assetUrl = (id: string) =>
    scope.publication
      ? communityAssetUrl(scope.publication, id, noteId)
      : access.assetUrl(id);
  const referenceNamespace = scope.publication
    ? `${access.namespace}/${scope.publication}`
    : access.namespace;
  const href = (id: string, library: string) =>
    scope.publication
      ? `/apps/thought-workshop/community/${scope.publication}/documents/${id}`
      : access.referenceHref(id, library);
  const references = useQuery({
    queryKey: thoughtKeys.references(
      referenceNamespace,
      field.type === "note" && Array.isArray(value) ? value : [],
    ),
    queryFn: async ({ signal }) => {
      const ids = Array.isArray(value) ? value : [];
      if (!scope.publication) return access.resolveReferences(ids, signal);
      const directory = await getCommunityDirectory(scope.publication, signal);
      return ids.map((id) => {
        const n = directory.documents.find((n) => n.id === id);
        return n
          ? {
              id,
              available: true,
              title: n.title,
              knowledge_base_id: n.knowledge_base_id,
              excerpt: n.excerpt,
              revision: n.revision,
            }
          : {
              id,
              available: false,
              title: "",
              knowledge_base_id: null,
              excerpt: "",
              revision: null,
            };
      });
    },
    enabled: field.type === "note" && Array.isArray(value) && value.length > 0,
    retry: false,
  });
  const choices = useQuery({
    queryKey: thoughtKeys.multitableChoices(referenceNamespace, query),
    queryFn: async ({ signal }) => {
      if (!scope.publication) return access.searchNotes({ query }, 0, signal);
      const directory = await getCommunityDirectory(scope.publication, signal);
      const items = directory.documents.filter((n) =>
        `${n.title} ${n.excerpt}`.toLowerCase().includes(query.toLowerCase()),
      );
      return { items, total: items.length };
    },
    enabled: edit && field.type === "note",
    retry: false,
  });
  if (readOnly) {
    if (field.type === "note")
      return (
        <span>
          <TransferFeedback progress={activeTransferProgress} />

          {references.data?.map((r) => (
            <span key={r.id}>
              {r.available ? (
                <a href={href(r.id, r.knowledge_base_id!)}>{r.title}</a>
              ) : (
                "文档不可访问"
              )}{" "}
            </span>
          )) ??
            (Array.isArray(value) && value.length ? (
              <LoadingState variant="inline" label="正在加载引用…" />
            ) : (
              ""
            ))}
        </span>
      );
    if (field.type === "attachment")
      return (
        <span>
          <TransferFeedback progress={activeTransferProgress} />

          {(Array.isArray(value) ? value : []).map((id) => (
            <AttachmentLink
              key={id}
              id={id}
              url={
                scope.publication
                  ? `/v1/thought-workshop/community/publications/${scope.publication}/assets/${id}/content?note_id=${noteId}`
                  : access.assetUrl(id)
              }
            />
          ))}
        </span>
      );
    if (field.type === "url" && typeof value === "string")
      return (
        <a href={value} target="_blank" rel="noreferrer">
          <TransferFeedback progress={activeTransferProgress} />

          {value}
        </a>
      );
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <FieldValue field={field} value={value} people={people} />
      </>
    );
  }
  if (field.type === "person")
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <PersonChoices
          label={field.name}
          multiple={!!field.config?.allow_multiple}
          value={value}
          people={people}
          editable={!scope.publication}
          onChange={change}
        />
      </>
    );
  if (field.type === "checkbox")
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <input
          type="checkbox"
          aria-label={field.name}
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
      </>
    );
  if (field.type === "single")
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <CustomSelect
          ariaLabel={field.name}
          className="multitable-choice"
          leadingIcon={
            <FieldValue field={field} value={value} people={people} />
          }
          showChevron={false}
          value={typeof value === "string" ? value : ""}
          options={[
            { value: "", label: "未设置" },
            ...(field.options ?? []).map((o) => ({
              value: o.id,
              label: o.label,
              swatch: o.color,
            })),
          ]}
          onChange={(v) => change(v || null)}
        />
      </>
    );
  const applyText = () => {
    try {
      change(parseCell(field, text));
      setEdit(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <>
      <TransferFeedback progress={activeTransferProgress} />

      <button
        className="multitable-cell-trigger"
        aria-label={`编辑 ${field.name}`}
        onClick={() => {
          setText(display(field, value));
          setEdit(true);
        }}
      >
        {field.type === "note" ? (
          references.data
            ?.map((r) => (r.available ? r.title : "文档不可访问"))
            .join("; ") || "添加笔记引用"
        ) : field.type === "attachment" ? (
          `${Array.isArray(value) ? value.length : 0} 个附件`
        ) : (
          <FieldValue field={field} value={value} people={people} />
        )}
      </button>
      {edit && (
        <Modal title={`编辑 ${field.name}`} close={() => setEdit(false)}>
          {error && <p role="alert">{error}</p>}
          {field.type === "date" ? (
            <CustomDateInput
              ariaLabel={field.name}
              value={text}
              onChange={setText}
            />
          ) : field.type === "multi" ? (
            <div className="multitable-options">
              {(field.options ?? []).map((o) => (
                <label key={o.id}>
                  <input
                    type="checkbox"
                    checked={(Array.isArray(value) ? value : []).includes(o.id)}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? [...(Array.isArray(value) ? value : []), o.id]
                          : (Array.isArray(value) ? value : []).filter(
                              (id) => id !== o.id,
                            ),
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          ) : field.type === "attachment" ? (
            <div>
              <label className="btn">
                上传附件
                <input
                  type="file"
                  aria-label="上传附件"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    const publication = scope.publication;
                    void (async () => {
                      const uploaded = [];
                      for (const file of files)
                        uploaded.push(
                          (
                            await (scope.publication
                              ? runTransfer((onProgress) =>
                                  uploadCommunityFile(
                                    publication!,
                                    noteId,
                                    file,
                                    { onProgress },
                                  ),
                                )
                              : runTransfer((onProgress) =>
                                  access.uploadAttachment(file, { onProgress }),
                                ))
                          ).asset_id,
                        );
                      change([
                        ...(Array.isArray(value) ? value : []),
                        ...uploaded,
                      ]);
                    })().catch((e) => setError(String(e)));
                  }}
                />
              </label>
              <div>
                {(Array.isArray(value) ? value : []).map((id) => (
                  <div key={id}>
                    <AttachmentLink id={id} url={assetUrl(id)} />
                    <button
                      className="btn"
                      onClick={() =>
                        change((value as string[]).filter((v) => v !== id))
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : field.type === "note" ? (
            <div>
              <input
                aria-label="搜索笔记"
                placeholder="搜索可访问笔记"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {(choices.data?.items ?? []).map((n) => (
                <label className="multitable-option" key={n.id}>
                  <input
                    type="checkbox"
                    checked={(Array.isArray(value) ? value : []).includes(n.id)}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? [...(Array.isArray(value) ? value : []), n.id]
                          : (Array.isArray(value) ? value : []).filter(
                              (id) => id !== n.id,
                            ),
                      )
                    }
                  />
                  {n.title}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              aria-label={field.name}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing
                )
                  applyText();
              }}
            />
          )}
          <div className="multitable-actions">
            <button
              className="btn"
              onClick={() => {
                change(null);
                setEdit(false);
              }}
            >
              清空
            </button>
            <button
              className="btn primary"
              onClick={() =>
                ["multi", "attachment", "note"].includes(field.type)
                  ? setEdit(false)
                  : applyText()
              }
            >
              完成
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
