import { lazy, Suspense, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { useDocumentAccess } from "../DocumentAccess";
import { thoughtKeys } from "../queryKeys";
import { tableStructure } from "./api";
import { Modal } from "./Modal";
import "./multitable.css";
const TableEditor = lazy(() =>
  import("./TableEditor").then((m) => ({ default: m.TableEditor })),
);
function EmbedView({ node, editor, updateAttributes }: NodeViewProps) {
  const canWrite = useWorkspacePermission("content.write");
  const access = useDocumentAccess(),
    [choose, setChoose] = useState(false),
    [query, setQuery] = useState(""),
    [target, setTarget] = useState("");
  const scope = {
    publication: access.publicationId,
    parent: access.currentNoteId,
  };
  const notes = useQuery({
    queryKey: thoughtKeys.multitableChoices(access.namespace, query),
    queryFn: ({ signal }) => access.searchNotes({ query }, 0, signal),
    enabled: choose,
    retry: false,
  });
  const structure = useQuery({
    queryKey: thoughtKeys.multitable(access.namespace, target),
    queryFn: ({ signal }) =>
      tableStructure(target, { publication: scope.publication }, signal),
    enabled: choose && !!target,
    retry: false,
  });
  return (
    <NodeViewWrapper className="multitable-embed" contentEditable={false}>
      {editor.isEditable && (
        <button className="btn" onClick={() => setChoose(true)}>
          选择多维表格视图
        </button>
      )}
      {node.attrs.noteId && node.attrs.tableId && node.attrs.viewId ? (
        <Suspense fallback={<p>正在加载表格视图…</p>}>
          <TableEditor
            key={`${access.namespace}/${node.attrs.noteId}/${node.attrs.tableId}/${node.attrs.viewId}`}
            noteId={node.attrs.noteId}
            scope={scope}
            readOnly={!access.community && !canWrite}
            embedded={{
              tableId: node.attrs.tableId,
              viewId: node.attrs.viewId,
            }}
          />
        </Suspense>
      ) : (
        <p>选择一个多维表格文档及其视图。</p>
      )}
      {choose && (
        <Modal title="插入多维表格视图" close={() => setChoose(false)}>
          <input
            aria-label="搜索多维表格"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <CustomSelect
            ariaLabel="多维表格文档"
            value={target}
            options={[
              { value: "", label: "选择文档" },
              ...(notes.data?.items ?? [])
                .filter((n) => n.kind === "multitable")
                .map((n) => ({ value: n.id, label: n.title })),
            ]}
            onChange={setTarget}
          />
          {structure.data?.tables.map((t) => (
            <section key={t.id}>
              <h3>{t.name}</h3>
              {t.views.map((v) => (
                <button
                  className="btn"
                  key={v.id}
                  onClick={() => {
                    updateAttributes({
                      noteId: target,
                      tableId: t.id,
                      viewId: v.id,
                    });
                    setChoose(false);
                  }}
                >
                  {v.name}
                </button>
              ))}
            </section>
          ))}
          {structure.isError && (
            <p role="alert">表格不可访问，或尚未单独发布。</p>
          )}
        </Modal>
      )}
    </NodeViewWrapper>
  );
}
export const MultitableViewNode = Node.create({
  name: "multitableView",
  group: "block",
  atom: true,
  addAttributes() {
    return Object.fromEntries(
      ["noteId", "tableId", "viewId"].map((key) => [
        key,
        {
          default: null,
          parseHTML: (e: HTMLElement) =>
            e.getAttribute(`data-${key.toLowerCase()}`),
          renderHTML: (attrs: Record<string, string>) =>
            attrs[key] ? { [`data-${key.toLowerCase()}`]: attrs[key] } : {},
        },
      ]),
    );
  },
  parseHTML() {
    return [{ tag: "div[data-multitable-view]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-multitable-view": "" }),
      "多维表格视图",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
