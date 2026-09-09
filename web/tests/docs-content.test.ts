import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUIDE_PAGES,
  GROUPS,
  PAGE_BY_ID,
  parseArticle,
  resolveDocLink,
  resolveLocation,
} from "../src/docs/content";
import aliases from "../src/docs/legacyLinks.json";
import screenshotSources from "../public/docs/sources.json";
import {
  parseProjectFile,
  buildSrt,
} from "../src/features/audio-annotation/model";

describe("documentation source of truth", () => {
  it("records a source and matching checksum for each published screenshot", () => {
    expect(new Set(screenshotSources.map((s) => s.file)).size).toBe(
      screenshotSources.length,
    );
    for (const source of screenshotSources) {
      expect(source.source).not.toBe("");
      const bytes = readFileSync(resolve("public/docs", source.file));
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        source.file,
      ).toBe(source.sha256);
    }
    for (const page of GUIDE_PAGES.filter((p) => p.category === "use")) {
      for (const m of page.markdown.matchAll(/!\[[^\]]+\]\(\/docs\/([^\s)]+)/g))
        expect(
          screenshotSources.some((s) => s.file === m[1]),
          m[1],
        ).toBe(true);
    }
  });
  it("uses an actual export accepted by the annotation importer and SRT exporter", () => {
    const page = PAGE_BY_ID.get("annotation-json")!;
    const example = JSON.parse(
      /```json\n([\s\S]*?)```/.exec(page.markdown)![1],
    );
    const parsed = parseProjectFile(example);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.project.duration_ms).toBe(8000);
    expect(buildSrt(parsed.segments, parsed.speakers)).toContain(
      "主持人：欢迎来到我们的第一段访谈。",
    );
  });
  it("contains complete usage articles, unique identities and valid evidence", () => {
    const usage = GUIDE_PAGES.filter((p) => p.category === "use");
    expect(usage.length).toBeGreaterThanOrEqual(105);
    expect(PAGE_BY_ID.size).toBe(GUIDE_PAGES.length);
    for (const page of GUIDE_PAGES) {
      expect(
        GROUPS.some((g) => g.id === page.group),
        page.id,
      ).toBe(true);
      expect(new Set(page.headings.map((h) => h.id)).size, page.id).toBe(
        page.headings.length,
      );
      if (page.category !== "use") continue;
      expect(page.markdown.length, page.id).toBeGreaterThan(180);
      expect(
        page.headings.filter((h) => h.level === 1),
        page.id,
      ).toHaveLength(1);
      expect(
        page.headings.filter((h) => h.level > 1).length,
        page.id,
      ).toBeGreaterThanOrEqual(2);
      expect(page.markdown, page.id).not.toMatch(/TODO|待补充|敬请期待/);
      for (const file of page.evidence)
        if (!file.startsWith("https://"))
          expect(existsSync(resolve("..", file)), page.id + ": " + file).toBe(
            true,
          );
    }
  });
  it("resolves all legacy sections to an existing article heading", () => {
    for (const [old, target] of Object.entries(aliases)) {
      const [id, hash] = old.split("#");
      const resolved = resolveLocation(id, hash);
      expect(resolved.page.id + "#" + resolved.section).toBe(target);
      expect(
        resolved.page.headings.some((h) => h.id === resolved.section),
        old,
      ).toBe(true);
    }
  });
  it("checks every internal link, image, alternate text and JSON example", () => {
    for (const page of GUIDE_PAGES) {
      for (const m of page.markdown.matchAll(
        /(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
      )) {
        const [, image, alt, href] = m;
        if (image) {
          expect(alt.trim(), page.id).not.toBe("");
          if (href.startsWith("/docs/")) {
            const file = resolve("public", href.slice(1));
            expect(existsSync(file), file).toBe(true);
            expect(
              readFileSync(file).subarray(0, 40).toString(),
              file,
            ).not.toContain("git-lfs");
          }
          continue;
        }
        if (/^https?:|^mailto:/.test(href)) continue;
        const result = resolveDocLink(page, href);
        if (result.startsWith("/docs.html") || result.startsWith("#")) {
          const url = new URL(
            result,
            "http://docs.test/docs.html?page=" + page.id,
          );
          const id = url.searchParams.get("page") || page.id;
          if (id.startsWith("dev-") && !PAGE_BY_ID.has(id)) continue; // Protected docs arrive only after authorization.
          expect(PAGE_BY_ID.has(id), page.id + ": " + href).toBe(true);
          const resolved = resolveLocation(id, url.hash);
          if (resolved.section)
            expect(
              resolved.page.headings.some((h) => h.id === resolved.section),
              page.id + ": " + href,
            ).toBe(true);
        } else if (
          result.startsWith(
            "https://github.com/EmiyaredA/Future-Props-Lab/blob/HEAD/",
          )
        ) {
          const local = decodeURIComponent(
            new URL(result).pathname.split("/blob/HEAD/")[1],
          );
          expect(existsSync(resolve("..", local)), page.id + ": " + href).toBe(
            true,
          );
        } else if (/\.md(?:#|$)/.test(href))
          throw Error("Unresolved Markdown link " + page.id + ": " + href);
      }
      if (page.category === "use")
        for (const match of page.markdown.matchAll(
          /```json\s*\n([\s\S]*?)```/g,
        ))
          expect(() => JSON.parse(match[1]), page.id).not.toThrow();
    }
  });
  it("ignores fenced headings and preserves explicit Unicode anchors", () => {
    const result = parseArticle(
      "# 首页\n## 章节 {#stable}\n```md\n## 示例\n```\n### 细节\n### 细节",
    );
    expect(result.headings.map((h) => h.id)).toEqual([
      "首页",
      "stable",
      "细节",
      "细节-1",
    ]);
  });
});
