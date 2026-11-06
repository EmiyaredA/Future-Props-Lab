import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { TECHNICAL_LIBRARY } from "@features/thought-workshop/official/technicalCatalog";
import { loadOfficialDocument } from "@features/thought-workshop/official/content";
import {
  loadOfficialCanvas,
  officialSearchText,
} from "@features/thought-workshop/official/figures";
import {
  canvasAssetIds,
  parseCanvasScene,
} from "@features/thought-workshop/diagrams/model";

const repositoryRoot = resolve(process.cwd(), "..");
const chapterSources = import.meta.glob(
  "../../src/features/thought-workshop/official/content/technical/*.md",
);
const figureSources = import.meta.glob(
  "../../src/features/thought-workshop/official/content/technical/figures/*.json",
);

describe("technical documentation library", () => {
  it("ships six ordered groups, preserves legacy IDs and covers every application", () => {
    const applications = TECHNICAL_LIBRARY.documents.filter(
      (doc) => doc.group === "各应用实现",
    );
    expect(applications.map((doc) => doc.id).sort()).toEqual(
      [
        "agent-workbench",
        ...APPLICATION_DEFINITIONS.map((app) => app.id),
      ].sort(),
    );
    expect(TECHNICAL_LIBRARY.documents.length - applications.length).toBe(21);
    expect(TECHNICAL_LIBRARY.documents).toHaveLength(
      APPLICATION_DEFINITIONS.length + 22,
    );
    expect(new Set(TECHNICAL_LIBRARY.documents.map((doc) => doc.id)).size).toBe(
      TECHNICAL_LIBRARY.documents.length,
    );
    expect(TECHNICAL_LIBRARY.documents.map((doc) => doc.order)).toEqual(
      Array.from(
        { length: APPLICATION_DEFINITIONS.length + 22 },
        (_, index) => index,
      ),
    );
    expect(TECHNICAL_LIBRARY.title).toBe("Future Props Lab 技术文档");
    expect([
      ...new Set(TECHNICAL_LIBRARY.documents.map((doc) => doc.group)),
    ]).toEqual([
      "系统全景与架构",
      "组件化设计",
      "数据模型与数据流",
      "模型与执行机制",
      "各应用实现",
      "工程验证与设计取舍",
    ]);
    expect(TECHNICAL_LIBRARY.documents.map((doc) => doc.id)).toEqual([
      "scope",
      "system",
      "modules",
      "frontend-design",
      "backend-design",
      "component-contracts",
      "app-handoffs",
      "data-model",
      "identity",
      "revision",
      "assets",
      "sqlite",
      "data-exchange",
      "providers",
      "tasks",
      "rendering",
      "automation",
      "presentation-workshop",
      "thought-workshop",
      "visual-workshop",
      "galgame-workshop",
      "video-editor",
      "motion-compositor",
      "audio-annotation",
      "agent-workbench",
      "interview-assistant",
      "director-desk",
      "desktop",
      "contracts",
      "engineering",
      "decisions",
    ]);
    expect(Object.keys(chapterSources)).toHaveLength(
      TECHNICAL_LIBRARY.documents.length,
    );
  });

  it("loads every figure reference and keeps explanatory legends and code entrypoints alongside it", async () => {
    const referencedFigures = new Set<string>();
    const mermaidKinds = new Set<string>();
    for (const chapter of TECHNICAL_LIBRARY.documents) {
      const markdown = await loadOfficialDocument(chapter);
      const tree = unified().use(remarkParse).parse(markdown);
      const titles = tree.children.filter(
        (node) => node.type === "heading" && node.depth === 1,
      );
      expect(titles, chapter.id).toHaveLength(1);
      expect(markdown.split("\n")[0], chapter.id).toBe(`# ${chapter.title}`);
      for (const ref of chapter.related) {
        expect(markdown, chapter.id).toContain(
          `/official-knowledge-bases/${ref.libraryId}/documents/${ref.documentId}`,
        );
      }
      const code = tree.children.filter((node) => node.type === "code");
      const figures = code.filter((node) => node.lang === "fpl-canvas");
      const uml = code.filter((node) => node.lang === "mermaid");
      expect(figures.length, chapter.id).toBeGreaterThanOrEqual(1);
      expect(uml.length, chapter.id).toBeGreaterThanOrEqual(1);
      expect(
        markdown.match(/^图例：/gm)?.length,
        chapter.id,
      ).toBeGreaterThanOrEqual(figures.length + uml.length);
      // Diagrams need a question/title before them and an explanation after
      // them; avoid forcing all articles into the same boilerplate headings.
      for (const diagram of [...figures, ...uml]) {
        const position = tree.children.indexOf(diagram);
        expect(
          tree.children
            .slice(0, position)
            .some((node) => node.type === "heading" && node.depth === 2),
          chapter.id,
        ).toBe(true);
        const explanation = tree.children
          .slice(position + 1)
          .find((node) => node.type === "paragraph");
        expect(explanation, chapter.id).toBeDefined();
      }
      expect(markdown, chapter.id).toMatch(/\[!(NOTE|TIP|WARNING)\]/);
      expect(markdown.length, chapter.id).toBeGreaterThan(1500);
      for (const figure of figures) {
        const id = figure.value.trim();
        expect(referencedFigures.has(id), `duplicate figure ${id}`).toBe(false);
        referencedFigures.add(id);
        const scene = await loadOfficialCanvas(id);
        expect(parseCanvasScene(scene)).toEqual(scene);
        expect(scene.elements.length, id).toBeGreaterThanOrEqual(4);
        // Built-in figures may be copied in any workspace; they cannot refer to
        // a maintainer's private asset ID or require an external image host.
        expect(canvasAssetIds(scene), id).toEqual([]);
      }
      for (const diagram of uml) {
        mermaidKinds.add(diagram.value.split("\n")[0].trim());
        expect(diagram.value, chapter.id).not.toMatch(
          /%%\{init|<script|click\s/,
        );
      }
      const codePaths = [...markdown.matchAll(/^\d+\. `([^`]+)`/gm)].map(
        (match) => match[1],
      );
      expect(codePaths.length, chapter.id).toBeGreaterThanOrEqual(3);
      for (const path of codePaths) {
        expect(path).not.toMatch(/^(\/|\.\.)/);
        expect(
          existsSync(`${repositoryRoot}/${path}`),
          `${chapter.id}: ${path}`,
        ).toBe(true);
      }
    }
    expect(referencedFigures.size).toBe(Object.keys(figureSources).length);
    expect([...mermaidKinds].sort()).toEqual(
      [
        "classDiagram",
        "erDiagram",
        "flowchart LR",
        "flowchart TD",
        "sequenceDiagram",
        "stateDiagram-v2",
      ].sort(),
    );
  });

  it("indexes figure-only labels and rejects unresolved or unsafe figure identifiers", async () => {
    const system = TECHNICAL_LIBRARY.documents.find(
      (chapter) => chapter.id === "system",
    )!;
    const markdown = await loadOfficialDocument(system);
    const scene = await loadOfficialCanvas("system");
    const text = await officialSearchText(markdown);
    for (const element of scene.elements) expect(text).toContain(element.text);
    for (const edge of scene.edges) expect(text).toContain(edge.label);
    await expect(loadOfficialCanvas("../system")).rejects.toThrow("无效");
    await expect(loadOfficialCanvas("missing-reference")).rejects.toThrow(
      "不存在",
    );
  });

  it("keeps ownership diagrams and executable SDK examples faithful to their boundaries", async () => {
    const system = await loadOfficialCanvas("system");
    expect(
      system.edges.some(
        (edge) => edge.source === "db" && edge.target === "files",
      ),
    ).toBe(false);
    expect(
      system.edges
        .filter((edge) => edge.source === "api")
        .map((edge) => edge.target)
        .sort(),
    ).toEqual(["db", "files"]);
    const automation = await loadOfficialDocument(
      TECHNICAL_LIBRARY.documents.find((doc) => doc.id === "automation")!,
    );
    const sdk = readFileSync(
      `${repositoryRoot}/sdk/python/src/future_props_lab/generated/resources/thought.py`,
      "utf8",
    );
    for (const method of [
      "knowledge_base",
      "create_note",
      "get_note",
      "put_note",
    ]) {
      expect(automation).toContain(method);
      expect(sdk).toContain(`def ${method}(`);
    }
    expect(automation).toContain(
      '"expected_knowledge_revision": library.revision',
    );
    expect(automation).toContain('"schema_version": 2');
    expect(automation).toContain('"sceneVersion": 1');
  });
});
