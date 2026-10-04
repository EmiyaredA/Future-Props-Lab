import { createElement } from "react";
import type { JSONContent } from "@tiptap/core";
import { DocumentCard } from "./DocumentCard";
import type { CardTarget } from "./model";
import "./prose.css";

// Bundled home pages share the block contract and card presentation with NodeViews.
export function NavigationDocument({
  document,
  resolve,
  open,
}: {
  document: JSONContent;
  resolve: (
    target: CardTarget,
  ) => { title: string; summary: string; href: string } | undefined;
  open: (target: CardTarget) => void;
}) {
  const render = (node: JSONContent, key: number): React.ReactNode => {
    if (node.type === "text") return node.text;
    if (node.type === "documentCard") {
      const target = node.attrs as CardTarget,
        value = resolve(target);
      return (
        <div key={key} className="document-card-node">
          <DocumentCard
            title={value?.title ?? "文档不可访问"}
            summary={value?.summary}
            href={value?.href}
            featured={target.style === "featured"}
            eyebrow={target.eyebrow}
            onOpen={() => open(target)}
          />
        </div>
      );
    }
    const children = node.content?.map(render);
    if (node.type === "heading")
      return createElement(`h${node.attrs?.level ?? 2}`, { key }, children);
    if (node.type === "paragraph") return <p key={key}>{children}</p>;
    if (node.type === "cardGrid")
      return (
        <div className="document-card-grid" key={key}>
          {children}
        </div>
      );
    return <div key={key}>{children}</div>;
  };
  return (
    <div className="thought-prose document-prose">
      {document.content?.map(render)}
    </div>
  );
}
