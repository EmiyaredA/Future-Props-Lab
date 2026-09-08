export type DocsCategory = "use" | "developer" | "api";
export type DocHeading = { id: string; title: string; level: number };
export type GuidePage = {
  id: string;
  title: string;
  lead: string;
  group: string;
  category: DocsCategory;
  context?: string;
  order: number;
  markdown: string;
  headings: DocHeading[];
  evidence: string[];
  source: string;
};
export type DocsGroup = {
  id: string;
  title: string;
  section: string;
  context?: string;
  parent?: string;
};
