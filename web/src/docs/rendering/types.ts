import type { ElementType } from "react";
export type DocNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      name: string;
      attributes: Record<string, unknown>;
      children: DocNode[];
    };
export type DocHeading = {
  level: number;
  title: string;
  slug: string;
  parent?: boolean;
};
export type DocPageMetadata = {
  id: string;
  title: string;
  category?: string;
  group?: string;
  order?: number;
  keywords?: string[];
  developerDoc?: { page: string; label: string };
  [key: string]: unknown;
};
export type DocDocument = {
  version: 1;
  metadata: DocPageMetadata;
  sourcePath: string;
  nodes: DocNode[];
  headings: DocHeading[];
  links: string[];
  assets: string[];
  searchText: string;
  markdown?: string;
};
export type DocComponentMap = Record<string, ElementType>;
export type DocUrls = {
  pageHref: (page: { id: string }) => string;
  assetHref: (name: string) => string;
  displayAssetHref: (name: string) => string;
};
