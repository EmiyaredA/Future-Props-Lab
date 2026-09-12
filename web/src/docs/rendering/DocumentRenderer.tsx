// Adapted from Sayflow shared/docs; see README.md in this directory.
import { createElement, Fragment, type ReactNode } from "react";
import { createDocComponents } from "./createDocComponents";
import type { DocComponentMap, DocDocument, DocNode, DocUrls } from "./types";
const native = new Set(
  "details summary p div span h1 h2 h3 h4 h5 h6 a img em strong del code pre blockquote ul ol li table thead tbody tr th td hr br input section sup footnote".split(
    " ",
  ),
);
const attributes = new Set(
  "open id href src alt title className colSpan rowSpan align start checked disabled type tabIndex ariaLabel ariaDescribedBy ariaHidden dataFootnoteRef dataFootnoteBackref dataGuideToc dataGuideTocLevel".split(
    " ",
  ),
);
const defaultUrls: DocUrls = {
  pageHref: (page) => `/docs.html?page=${encodeURIComponent(page.id)}`,
  assetHref: (name) => name,
  displayAssetHref: (name) => name,
};
export function DocumentRenderer({
  document,
  components,
  urls = defaultUrls,
  resolveLink,
  resolveAsset,
}: {
  document: DocDocument;
  components?: DocComponentMap;
  urls?: DocUrls;
  resolveLink?: (href: string) => string;
  resolveAsset?: (src: string) => string;
}) {
  if (document.version !== 1)
    return <p role="alert">文档格式不受支持，请刷新页面。</p>;
  const registry = {
    ...createDocComponents(
      urls,
      document.metadata.developerDoc,
      document.metadata,
    ),
    ...components,
  };
  function render(node: DocNode, key: number): ReactNode {
    if (node.type === "text") return node.value;
    if (
      node.type !== "element" ||
      (!native.has(node.name) && !registry[node.name])
    )
      return null;
    const custom = !native.has(node.name),
      props: Record<string, unknown> = { key };
    for (const [name, value] of Object.entries(node.attributes || {})) {
      if (
        !custom &&
        !attributes.has(name) &&
        !name.startsWith("data-guide-") &&
        !name.startsWith("aria-")
      )
        continue;
      if (
        /^on/i.test(name) ||
        name === "dangerouslySetInnerHTML" ||
        name === "style"
      )
        continue;
      props[name] =
        name === "className" && Array.isArray(value) ? value.join(" ") : value;
    }
    for (const name of ["href", "src"]) {
      if (typeof props[name] !== "string") continue;
      if (
        /^(?:javascript|vbscript|data|file):/i.test(
          props[name]
            .split("")
            .filter(
              (char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127,
            )
            .join(""),
        )
      )
        delete props[name];
      else
        props[name] =
          name === "href"
            ? (resolveLink?.(props[name]) ?? props[name])
            : (resolveAsset?.(props[name]) ?? props[name]);
    }
    if (
      node.name === "a" &&
      typeof props.href === "string" &&
      /^https?:/.test(props.href)
    ) {
      props.target = "_blank";
      props.rel = "noopener noreferrer";
    }
    const children = node.children
      ?.filter(
        (child) =>
          !(
            ["table", "thead", "tbody", "tr"].includes(node.name) &&
            child.type === "text" &&
            !child.value.trim()
          ),
      )
      .map(render);
    return createElement(
      registry[node.name] || node.name,
      props,
      ...(children || []),
    );
  }
  return <Fragment>{document.nodes.map(render)}</Fragment>;
}
