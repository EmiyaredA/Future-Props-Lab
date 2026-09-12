// Adapted from Sayflow shared/docs; see README.md in this directory.
import { FeatureIcon } from "./DocIcons";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
  type JSX,
} from "react";

import type {
  DocPageMetadata as GuidePage,
  DocUrls as GuideUrls,
} from "./types";

import { DocFormula, DocMermaid, DocCode } from "./DocMedia";

type ChildrenProps = { children?: ReactNode };
type TitleProps = ChildrenProps & { id: string; title: string };

const HeadingLevel = createContext(3);

function withClass(children: ReactNode, type: string, className: string) {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== type) return child;
    return cloneElement(child as ReactElement<{ className?: string }>, {
      className,
    });
  });
}

export function Lead({
  children,
  developerDoc,
}: ChildrenProps & Pick<GuidePage, "developerDoc">) {
  return (
    <>
      {withClass(children, "p", "article-lead")}
      {developerDoc ? (
        <a
          className="developer-guide-link"
          data-developer-docs-link
          hidden
          href={`/developer-docs.html?page=${encodeURIComponent(developerDoc.page)}`}
        >
          {developerDoc.label}
          <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </>
  );
}

export function Purpose({
  title,
  children,
}: ChildrenProps & { title?: string }) {
  return (
    <section className="purpose" aria-labelledby="purpose-title">
      <h2 id="purpose-title" data-guide-toc data-guide-toc-level="2">
        {title || "这个功能解决什么问题"}
      </h2>
      <ul className="purpose-list">{children}</ul>
    </section>
  );
}

export function PurposeItem({
  title,
  icon,
  children,
}: ChildrenProps & { title?: string; icon?: string }) {
  const content = Children.map(children, (child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === "p"
      ? child.props.children
      : child,
  );
  return (
    <li className="purpose-card">
      <FeatureIcon kind={icon || "check"} />
      {title ? <strong>{title}</strong> : null}
      <span>{content}</span>
    </li>
  );
}

export function Steps({
  id = "how-to",
  title = "怎么使用",
  children,
}: ChildrenProps & { id?: string; title?: string }) {
  const items = Children.toArray(children).filter(
    (child) => typeof child !== "string" || child.trim(),
  );
  const structured = items.some(
    (child) => isValidElement(child) && child.type === Step,
  );
  return (
    <section className="article-section guide-steps" aria-labelledby={id}>
      <h2 id={id} data-guide-toc data-guide-toc-level="2">
        {title}
      </h2>
      <HeadingLevel.Provider value={3}>
        {structured ? (
          <ol className="steps steps--structured" role="list">
            {items.map((child, index) =>
              cloneElement(child as ReactElement<{ number?: number }>, {
                number: index + 1,
              }),
            )}
          </ol>
        ) : (
          withClass(children, "ol", "steps")
        )}
      </HeadingLevel.Provider>
    </section>
  );
}

export function Step({
  title,
  number,
  children,
}: ChildrenProps & { title: string; number?: number }) {
  return (
    <li className="guide-step">
      <span className="guide-step-number" aria-hidden="true">
        {number}
      </span>
      <h3 className="guide-step-title">{title}</h3>
      <HeadingLevel.Provider value={4}>{children}</HeadingLevel.Provider>
    </li>
  );
}

export function Section({ id, title, children }: TitleProps) {
  return (
    <section className="article-section" aria-labelledby={id}>
      <h2 id={id} data-guide-toc data-guide-toc-level="2">
        {title}
      </h2>
      <HeadingLevel.Provider value={3}>{children}</HeadingLevel.Provider>
    </section>
  );
}

export function SectionGroup({ id, title, children }: TitleProps) {
  return (
    <section className="article-section section-group" aria-labelledby={id}>
      <h2 id={id} data-guide-toc data-guide-toc-level="2" data-guide-toc-parent>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Subsection({ id, title, children }: TitleProps) {
  return (
    <section className="article-subsection" aria-labelledby={id}>
      <h3 id={id} data-guide-toc data-guide-toc-level="3">
        {title}
      </h3>
      <HeadingLevel.Provider value={4}>{children}</HeadingLevel.Provider>
    </section>
  );
}

export function Screenshot({
  src,
  title,
  children,
  urls,
}: ChildrenProps & { src: string; title: string; urls: GuideUrls }) {
  const level = useContext(HeadingLevel);
  const Heading = `h${level}` as keyof JSX.IntrinsicElements;
  return (
    <figure className="shot">
      <a
        className="shot-link"
        href={urls.assetHref(src)}
        target="_blank"
        rel="noreferrer"
      >
        <img
          src={urls.displayAssetHref(src)}
          alt={title}
          width={1800}
          height={1125}
          loading="lazy"
          decoding="async"
        />
      </a>
      <figcaption>
        <Heading className="shot-title">{title}</Heading>
        <HeadingLevel.Provider value={Math.min(level + 1, 6)}>
          {withClass(children, "ul", "shot-points")}
        </HeadingLevel.Provider>
      </figcaption>
    </figure>
  );
}

export function ChunkExample({
  title,
  children,
}: ChildrenProps & { title?: string }) {
  const level = useContext(HeadingLevel);
  const Heading = `h${level}` as keyof JSX.IntrinsicElements;
  return (
    <div className="chunk-example">
      <Heading className="chunk-example-title">{title || "分块示例"}</Heading>
      <div className="chunk-example-grid">{children}</div>
    </div>
  );
}

export function ChunkInput({
  label,
  children,
}: ChildrenProps & { label?: string }) {
  return (
    <div className="chunk-example-column">
      <div className="chunk-example-label">
        <strong>{label || "输入文本"}</strong>
      </div>
      {children}
    </div>
  );
}

export function ChunkOutput({
  label,
  description,
  children,
}: ChildrenProps & { label?: string; description?: string }) {
  let index = 0;
  return (
    <div className="chunk-example-column">
      <div className="chunk-example-label">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {Children.map(children, (child) => {
        if (
          !isValidElement(child) ||
          (child.type !== "pre" && child.type !== MarkdownPre)
        )
          return child;
        index += 1;
        return (
          <div className="chunk-example-result">
            <span>片段 {index}</span>
            {child}
          </div>
        );
      })}
    </div>
  );
}

export function CardGroup({ children }: ChildrenProps) {
  return (
    <ul className="guide-card-group" role="list">
      {children}
    </ul>
  );
}

export function Card({
  title,
  href,
  icon,
  children,
}: ChildrenProps & { title: string; href: string; icon?: string }) {
  return (
    <li className="guide-card-item">
      <a className="guide-card" href={href}>
        {icon ? <FeatureIcon kind={icon} /> : null}
        <strong className="guide-card-title">
          {title}
          <span aria-hidden="true">→</span>
        </strong>
        <div className="guide-card-description">{children}</div>
      </a>
    </li>
  );
}

export function Example({
  title,
  children,
}: ChildrenProps & { title: string }) {
  return (
    <div className="guide-example">
      <strong className="guide-example-title">{title}</strong>
      <div className="guide-example-panels">{children}</div>
    </div>
  );
}

export function ExamplePanel({
  title,
  children,
}: ChildrenProps & { title: string }) {
  return (
    <div className="guide-example-panel">
      <strong className="guide-example-panel-title">{title}</strong>
      {children}
    </div>
  );
}

export function FieldGroup({ children }: ChildrenProps) {
  return <dl className="guide-fields">{children}</dl>;
}

export function Field({
  name,
  type,
  required,
  defaultValue,
  children,
}: ChildrenProps & {
  name: string;
  type?: string;
  required?: string;
  defaultValue?: string;
}) {
  return (
    <div className="guide-field">
      <dt>
        <strong>{name}</strong>
        {type ? <span className="guide-field-meta">{type}</span> : null}
        {required === "true" ? (
          <span className="guide-field-required">必填</span>
        ) : null}
      </dt>
      <dd>
        {defaultValue !== undefined ? (
          <p className="guide-field-default">
            默认值：<code>{defaultValue}</code>
          </p>
        ) : null}
        {children}
      </dd>
    </div>
  );
}

export function MarkdownPre({ children }: ComponentPropsWithoutRef<"pre">) {
  const code = Children.toArray(children).find(isValidElement) as
    ReactElement<{ className?: string; children?: ReactNode }> | undefined;
  const language = code?.props.className?.match(/language-([^\s]+)/)?.[1] || "";
  const source = String(code?.props.children || "").replace(/\n$/, "");
  if (language === "mermaid") return <DocMermaid source={source} />;
  if (language === "math") return <DocFormula source={source} />;
  return <DocCode source={source} language={language} />;
}

export function MarkdownTable(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div
      className="parameter-table-wrap"
      role="region"
      aria-label="表格，可横向滚动"
      tabIndex={0}
    >
      <table {...props} className="parameter-table" />
    </div>
  );
}

export function Callout({
  type,
  title,
  children,
}: ChildrenProps & { type?: string; title?: string }) {
  const labels: Record<string, string> = {
    info: "说明",
    tip: "建议",
    warning: "注意",
  };
  return (
    <aside
      className={`guide-callout guide-callout--${type || "info"}`}
      role="note"
    >
      <svg
        className="guide-callout-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {type === "warning" ? (
          <>
            <path d="m12 3 10 18H2L12 3Z" />
            <path d="M12 9v5m0 3v.1" />
          </>
        ) : type === "tip" ? (
          <>
            <path d="M9 18h6m-5 3h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6m0-10v.1" />
          </>
        )}
      </svg>
      <strong>
        <span className="guide-callout-label">{labels[type || "info"]}</span>
        {title ? `：${title}` : ""}
      </strong>
      {children}
    </aside>
  );
}
