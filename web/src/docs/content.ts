import type { DocHeading, DocsGroup, GuidePage } from "./types";
import legacyLinks from "./legacyLinks.json";
export type { GuidePage } from "./types";
export const GROUPS: DocsGroup[] = [
  {
    id: "presentation",
    title: "演示工坊",
    section: "AI 应用",
    context: "presentation",
    parent: "apps-overview",
  },
  { id: "start", title: "开始使用", section: "开始使用" },
  { id: "account", title: "工作空间与账号", section: "平台基础" },
  { id: "files", title: "文件管理", section: "平台基础" },
  { id: "integrations", title: "集成中心", section: "平台基础" },
  { id: "models", title: "模型服务", section: "模型能力" },
  { id: "testing", title: "模型测试", section: "模型能力" },
  { id: "logs", title: "调用日志", section: "模型能力" },
  { id: "apps", title: "应用与项目", section: "AI 应用" },
  {
    id: "visual",
    title: "视觉创作工坊",
    section: "AI 应用",
    context: "visual",
    parent: "apps-overview",
  },
  {
    id: "galgame",
    title: "Galgame 工坊",
    section: "AI 应用",
    context: "galgame",
    parent: "apps-overview",
  },
  {
    id: "video",
    title: "视频剪辑工坊",
    section: "AI 应用",
    context: "video",
    parent: "apps-overview",
  },
  {
    id: "thought",
    title: "思绪工坊",
    section: "AI 应用",
    context: "thought",
    parent: "apps-overview",
  },
  { id: "tools", title: "工具导航", section: "工具" },
  {
    id: "annotation",
    title: "录音分段标注",
    section: "工具",
    context: "annotation",
    parent: "tools-overview",
  },
  {
    id: "frames",
    title: "视频帧导出",
    section: "工具",
    context: "frames",
    parent: "tools-overview",
  },
  { id: "external", title: "外部工具", section: "工具" },
  { id: "help", title: "通用帮助", section: "通用帮助" },
  { id: "engineering", title: "架构与开发", section: "开发者文档" },
  { id: "operations", title: "部署与运维", section: "开发者文档" },
  { id: "api", title: "API 参考", section: "API 参考" },
];
export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}
export function parseArticle(raw: string) {
  const headings: DocHeading[] = [];
  const counts = new Map<string, number>();
  let fenced = false;
  const markdown = raw
    .replace(/^<!-- docs:.*-->\s*/, "")
    .replace(/^<!-- prerequisites -->\s*/gm, "")
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const match = /^(#{1,3}) (.+?)(?:\s+\{#([^}]+)\})?\s*$/.exec(line);
      if (!match) return line;
      const [, hashes, title, explicit] = match;
      const base = explicit || headingId(title);
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      const id = explicit || (count ? base + "-" + count : base);
      headings.push({
        id,
        title: title.replace(/[`*]/g, ""),
        level: hashes.length,
      });
      return hashes + " " + title;
    })
    .join("\n");
  return { markdown, headings };
}
const articles = import.meta.glob("./articles/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const references = import.meta.glob(["../../../docs/reference/api.md"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
export const GUIDE_PAGES: GuidePage[] = Object.entries(articles).map(
  ([source, raw]) => {
    const meta = JSON.parse(/^<!-- docs: (.*) -->/.exec(raw)?.[1] || "{}");
    const group = GROUPS.find((item) => item.id === meta.group);
    if (!group) throw new Error("Unknown documentation group: " + source);
    return {
      ...meta,
      id: source.split("/").pop()!.replace(/\.md$/, ""),
      category: "use",
      context: group.context,
      source,
      ...parseArticle(raw),
    };
  },
);
for (const [source, raw] of Object.entries(references)) {
  const api = source.endsWith("/api.md");
  const name = source.split("/").pop()!.replace(/\.md$/, "");
  const parsed = parseArticle(raw);
  GUIDE_PAGES.push({
    id: api ? "api-reference" : "dev-" + name,
    title: parsed.headings[0]?.title || name,
    lead: "",
    group: api
      ? "api"
      : source.includes("/architecture/")
        ? "engineering"
        : "operations",
    category: api ? "api" : "developer",
    order: 0,
    source,
    evidence: [source.replace("../../../", "")],
    ...parsed,
  });
}
GUIDE_PAGES.sort(
  (a, b) =>
    GROUPS.findIndex((g) => g.id === a.group) -
      GROUPS.findIndex((g) => g.id === b.group) ||
    a.order - b.order ||
    a.id.localeCompare(b.id),
);
export const PAGE_BY_ID = new Map(GUIDE_PAGES.map((page) => [page.id, page]));
export function resolveLocation(pageId: string, hash: string) {
  let decoded = hash.replace(/^#/, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = "";
  }
  const key = pageId + "#" + decoded;
  const alias = (legacyLinks as Record<string, string>)[key];
  const [id, section] = alias ? alias.split("#") : [pageId, decoded];
  return { page: PAGE_BY_ID.get(id) || PAGE_BY_ID.get("overview")!, section };
}
export const CATEGORY_LABELS = {
  use: "使用文档",
  developer: "开发者文档",
  api: "API 参考",
} as const;
export function pageHref(page: GuidePage | string, section?: string) {
  return (
    "/docs.html?page=" +
    encodeURIComponent(typeof page === "string" ? page : page.id) +
    (section ? "#" + encodeURIComponent(section) : "")
  );
}
export function guideSearchText(page: GuidePage) {
  return (page.title + " " + page.lead + " " + page.markdown).toLocaleLowerCase(
    "zh-CN",
  );
}
export function searchHeading(page: GuidePage, term: string) {
  const titleMatch = page.headings.find(
    (h) => h.level > 1 && h.title.toLocaleLowerCase("zh-CN").includes(term),
  );
  if (titleMatch) return titleMatch;
  const matchAt = page.markdown.toLocaleLowerCase("zh-CN").indexOf(term);
  if (matchAt < 0) return undefined;
  const before = page.markdown.slice(0, matchAt);
  const parsed = parseArticle(before);
  const last = parsed.headings.at(-1);
  return last && last.level > 1
    ? page.headings.find((h) => h.id === last.id)
    : undefined;
}
export function resolveDocLink(page: GuidePage, href: string) {
  if (!href || /^(https?:|mailto:|#|\/)/.test(href)) return href;
  const clean = (source: string) =>
    source.startsWith("./articles/")
      ? "web/src/docs/" + source.slice(2)
      : source.replace(/^\.\.\/\.\.\/\.\.\//, "");
  const url = new URL(href, "https://docs.invalid/" + clean(page.source));
  const target = GUIDE_PAGES.find(
    (candidate) => "/" + clean(candidate.source) === url.pathname,
  );
  if (target) return pageHref(target) + url.hash;
  if (url.pathname.startsWith("/web/public/"))
    return url.pathname.slice("/web/public".length) + url.hash;
  return (
    "https://github.com/EmiyaredA/Future-Props-Lab/blob/HEAD" +
    url.pathname +
    url.hash
  );
}

// Protected markdown is fetched after authentication; never bundled into the public site.
export function replaceDeveloperDocuments(
  items: { id: string; source: string; group: string; markdown: string }[],
) {
  for (let index = GUIDE_PAGES.length - 1; index >= 0; index--) {
    if (GUIDE_PAGES[index].category === "developer") {
      PAGE_BY_ID.delete(GUIDE_PAGES[index].id);
      GUIDE_PAGES.splice(index, 1);
    }
  }
  for (const item of items) {
    const parsed = parseArticle(item.markdown);
    const page: GuidePage = {
      id: item.id,
      title: parsed.headings[0]?.title || item.id,
      lead: "",
      group: item.group,
      category: "developer",
      order: 0,
      source: item.source,
      evidence: [item.source.replace("../../../", "")],
      ...parsed,
    };
    GUIDE_PAGES.push(page);
    PAGE_BY_ID.set(page.id, page);
  }
}
