// Sayflow component registry with Future Props Lab operation and URL adapters.
import type { ComponentPropsWithoutRef } from "react";
import type {
  DocComponentMap as GuideMdxComponentMap,
  DocPageMetadata as GuidePage,
  DocUrls as GuideUrls,
} from "./types";
import { ApiOperations } from "./ApiOperations";
import { DocCode, DocFormula } from "./DocMedia";
import contract from "./componentContract.json";
import {
  Lead,
  Purpose,
  PurposeItem,
  Steps,
  Step,
  Section,
  SectionGroup,
  Subsection,
  Screenshot,
  ChunkExample,
  ChunkInput,
  ChunkOutput,
  CardGroup,
  Card,
  Example,
  ExamplePanel,
  FieldGroup,
  Field,
  MarkdownPre,
  MarkdownTable,
  Callout,
} from "./DocComponents";
const GUIDE_COMPONENT_CONTRACT = contract;
export function createDocComponents(
  urls: GuideUrls,
  developerDoc?: GuidePage["developerDoc"],
  metadata: Record<string, unknown> = {},
): GuideMdxComponentMap {
  const components: GuideMdxComponentMap = {
    ApiOperations,
    DataCode: ({
      source,
      language = "text",
    }: {
      source: string;
      language?: string;
    }) => (
      <DocCode source={String(metadata[source] || "")} language={language} />
    ),
    DataTable: ({ source }: { source: string }) => {
      const table = metadata[source] as
        { headings: string[]; rows: string[][] } | undefined;
      return table ? (
        <MarkdownTable>
          <thead>
            <tr>
              {table.headings.map((title) => (
                <th key={title}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </MarkdownTable>
      ) : null;
    },
    Lead: (props: ComponentPropsWithoutRef<typeof Lead>) => (
      <Lead {...props} developerDoc={developerDoc} />
    ),
    Purpose,
    PurposeItem,
    Steps,
    Step,
    Section,
    SectionGroup,
    Subsection,
    Screenshot: (
      props: Omit<ComponentPropsWithoutRef<typeof Screenshot>, "urls">,
    ) => <Screenshot {...props} urls={urls} />,
    ChunkExample,
    ChunkInput,
    ChunkOutput,
    Callout,
    Formula: DocFormula,
    InlineFormula: (props: { source: string; label?: string }) => (
      <DocFormula {...props} inline />
    ),
    CardGroup,
    Card,
    Example,
    ExamplePanel,
    FieldGroup,
    Field,
    table: MarkdownTable,
    pre: MarkdownPre,
  };
  for (const name of Object.keys(GUIDE_COMPONENT_CONTRACT)) {
    if (!components[name]) throw new Error(`指南组件未注册：${name}`);
  }
  return components;
}
