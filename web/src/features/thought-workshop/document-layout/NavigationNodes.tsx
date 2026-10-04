import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccountId,
  useWorkspaceId,
} from "@platform/auth/WorkspacePermissions";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ReferencePicker } from "../knowledge-tools/ReferencePicker";
import { useDocumentAccess } from "../DocumentAccess";
import { thoughtKeys } from "../queryKeys";
import { useLegacyReference } from "../community/legacyReference";
import { useNavigationScope } from "./NavigationScope";
import { DocumentCard } from "./DocumentCard";
import { emptyCard, type CardTarget, type DirectoryEntry } from "./model";

function useDirectory() {
  const scope = useNavigationScope(),
    access = useDocumentAccess();
  const account = useAccountId(),
    workspace = useWorkspaceId();
  const query = useQuery({
    queryKey: thoughtKeys.layoutDirectory(
      `${account}/${workspace}/${access.namespace}`,
      scope.libraryId,
    ),
    queryFn: ({ signal }) => access.directory!(scope.libraryId, signal),
    enabled: !!scope.libraryId && !!access.directory,
    retry: false,
    refetchInterval: 5000,
  });
  const entries: DirectoryEntry[] = query.isError ? [] : (query.data ?? []);
  return {
    ...query,
    entries,
    scope,
    access,
    ready: query.isSuccess,
  };
}
function CardView({
  node,
  editor,
  updateAttributes,
  getPos,
  deleteNode,
}: NodeViewProps) {
  const access = useDocumentAccess(),
    account = useAccountId(),
    workspace = useWorkspaceId();
  const attrs = node.attrs as CardTarget;
  const scope = useNavigationScope();
  const index = scope.cardIds.indexOf(attrs.noteId ?? ""),
    start = Math.floor(Math.max(0, index) / 100) * 100;
  const ids =
    index >= 0 ? scope.cardIds.slice(start, start + 100) : [attrs.noteId ?? ""];
  const [picker, setPicker] = useState(false);
  const target = useQuery({
    queryKey: thoughtKeys.references(
      `${account}/${workspace}/${access.namespace}`,
      ids,
    ),
    queryFn: ({ signal }) => access.resolveReferences(ids, signal),
    enabled: attrs.kind === "note" && !!attrs.noteId,
    retry: false,
    refetchInterval: 5000,
  });
  const official = useLegacyReference(
    attrs.kind,
    attrs.libraryId,
    attrs.documentId,
  );
  const resolved = !target.isError
    ? target.data?.find((row) => row.id === attrs.noteId && row.available)
    : undefined;
  const title =
    official?.title ??
    resolved?.title ??
    (attrs.noteId && target.isPending ? "正在加载文档…" : "文档不可访问");
  const href = official
    ? official.href
    : resolved
      ? access.referenceHref(resolved.id, resolved.knowledge_base_id!)
      : undefined;
  const position = getPos();
  const cardPosition =
    position === undefined ? null : editor.state.doc.resolve(position);
  const inGrid = cardPosition?.parent.type.name === "cardGrid";
  const move = (direction: number) => {
    const pos = getPos();
    if (pos === undefined) return;
    const $pos = editor.state.doc.resolve(pos),
      parent = $pos.parent;
    if (parent.type.name !== "cardGrid") return;
    const index = $pos.index(),
      destination = index + direction;
    if (destination < 0 || destination >= parent.childCount) return;
    const content = parent.toJSON().content;
    const [card] = content.splice(index, 1);
    content.splice(destination, 0, card);
    editor.commands.insertContentAt(
      { from: $pos.before(), to: $pos.after() },
      { type: "cardGrid", content },
    );
  };
  return (
    <NodeViewWrapper className="document-card-node" contentEditable={false}>
      <DocumentCard
        title={title}
        summary={official?.summary ?? resolved?.excerpt}
        href={href}
        onOpen={
          href && scope.navigate ? () => scope.navigate!(href) : undefined
        }
        featured={attrs.style === "featured"}
        eyebrow={attrs.eyebrow}
      />
      {editor.isEditable && (
        <div className="document-block-controls">
          <button className="btn" onClick={() => setPicker(true)}>
            选择文档
          </button>
          <CustomSelect
            ariaLabel="文档卡片样式"
            value={attrs.style}
            options={[
              { value: "standard", label: "普通卡片" },
              { value: "featured", label: "引导卡片" },
            ]}
            onChange={(style) => updateAttributes({ style })}
          />
          <input
            aria-label="卡片引导文字"
            maxLength={240}
            value={attrs.eyebrow}
            placeholder="引导文字"
            onChange={(e) => updateAttributes({ eyebrow: e.target.value })}
          />
          {inGrid && (
            <>
              <button
                className="btn"
                disabled={cardPosition!.index() === 0}
                aria-label="卡片上移"
                onClick={() => move(-1)}
              >
                上移
              </button>
              <button
                className="btn"
                aria-label="卡片下移"
                disabled={
                  cardPosition!.index() === cardPosition!.parent.childCount - 1
                }
                onClick={() => move(1)}
              >
                下移
              </button>
            </>
          )}
          <button className="btn" aria-label="删除卡片" onClick={deleteNode}>
            删除
          </button>
        </div>
      )}
      {picker && (
        <ReferencePicker
          title="选择卡片文档"
          confirmLabel="插入卡片"
          allowCustomLabel={false}
          close={() => setPicker(false)}
          choose={(ref) => {
            updateAttributes({
              kind: ref.kind,
              noteId: ref.noteId ?? null,
              libraryId: ref.libraryId ?? null,
              documentId: ref.documentId ?? null,
            });
            setPicker(false);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
function GridView({ editor, getPos, node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="document-card-grid">
      <NodeViewContent />
      {editor.isEditable && (
        <div className="document-block-controls" contentEditable={false}>
          <button
            className="btn"
            onClick={() => {
              const pos = getPos();
              if (pos !== undefined)
                editor.commands.insertContentAt(
                  pos + node.nodeSize - 1,
                  emptyCard(),
                );
            }}
          >
            添加卡片
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
function DirectoryView({ node, editor, updateAttributes }: NodeViewProps) {
  const { entries, scope, access, ready, isError, refetch } = useDirectory();
  const parent = node.attrs.parentId as string | null;
  const available = !parent || entries.some((entry) => entry.id === parent);
  const children =
    ready && available
      ? entries
          .filter((entry) => !entry.is_home && entry.parent_id === parent)
          .sort((a, b) => a.position - b.position)
      : [];
  const href = (item: DirectoryEntry) =>
    access.referenceHref(item.id, item.knowledge_base_id);
  return (
    <NodeViewWrapper
      className="document-directory-node"
      contentEditable={false}
    >
      {editor.isEditable && (
        <div className="document-block-controls">
          <CustomSelect
            ariaLabel="目录范围"
            value={parent ?? ""}
            options={[
              { value: "", label: "当前知识库" },
              ...entries
                .filter((e) => !e.is_home)
                .map((e) => ({ value: e.id, label: e.title })),
            ]}
            onChange={(parentId) =>
              updateAttributes({ parentId: parentId || null })
            }
          />
          <CustomSelect
            ariaLabel="目录展示方式"
            value={node.attrs.style}
            options={[
              { value: "list", label: "列表" },
              { value: "cards", label: "卡片" },
            ]}
            onChange={(style) => updateAttributes({ style })}
          />
        </div>
      )}
      {isError ? (
        <p role="alert">
          目录暂时不可访问{" "}
          <button className="btn" onClick={() => void refetch()}>
            重试
          </button>
        </p>
      ) : !ready ? (
        <p role="status">正在加载目录…</p>
      ) : !available ? (
        <p>目录不可访问</p>
      ) : !children.length ? (
        <p>此目录暂无可访问文档</p>
      ) : node.attrs.style === "cards" ? (
        <div className="document-card-grid">
          {children.map((item) => (
            <DocumentCard
              key={item.id}
              title={item.title}
              summary={item.excerpt}
              href={href(item)}
              onOpen={
                scope.navigate ? () => scope.navigate!(href(item)) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <ul className="document-directory-list">
          {children.map((item) => (
            <li key={item.id}>
              <a
                href={href(item)}
                onClick={
                  scope.navigate
                    ? (event) => {
                        if (
                          event.button ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        scope.navigate!(href(item));
                      }
                    : undefined
                }
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
function attributes(defaults: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      {
        default: value,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute(`data-navigation-${key.toLowerCase()}`) ?? value,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs[key] == null
            ? {}
            : { [`data-navigation-${key.toLowerCase()}`]: attrs[key] },
      },
    ]),
  );
}
export const DocumentCardNode = Node.create({
  name: "documentCard",
  group: "block",
  atom: true,
  addAttributes: () => attributes(emptyCard().attrs!),
  parseHTML: () => [{ tag: "div[data-document-card]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-document-card": "",
      class: "document-card-node",
    }),
    "文档卡片",
  ],
  addNodeView: () => ReactNodeViewRenderer(CardView),
});
export const CardGridNode = Node.create({
  name: "cardGrid",
  group: "block",
  content: "documentCard*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-card-grid]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-card-grid": "",
      class: "document-card-grid",
    }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(GridView),
});
export const DocumentDirectoryNode = Node.create({
  name: "documentDirectory",
  group: "block",
  atom: true,
  addAttributes: () => attributes({ parentId: null, style: "list" }),
  parseHTML: () => [{ tag: "div[data-document-directory]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-document-directory": "" }),
    "文档目录",
  ],
  addNodeView: () => ReactNodeViewRenderer(DirectoryView),
});
