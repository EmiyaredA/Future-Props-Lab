/** Build-time source export. Never used as a runtime reading catalog. */
import { readFileSync } from "node:fs";
import { OFFICIAL_KNOWLEDGE_BASES } from "../web/src/features/thought-workshop/official/catalog";
import { officialHomeDocument } from "../web/src/features/thought-workshop/official/homeDocument";
const base = "web/src/features/thought-workshop/official/";
const libraries = OFFICIAL_KNOWLEDGE_BASES.map((library) => ({
  ...library,
  home: officialHomeDocument(library),
  documents: library.documents.map((doc) => ({
    ...doc,
    markdown: readFileSync(base + doc.source, "utf8").replace(
      /```fpl-canvas\s*\n([a-z0-9-]+)\s*\n```/g,
      (_, id: string) =>
        "```fpl-canvas\n" +
        readFileSync(base + `content/technical/figures/${id}.json`, "utf8") +
        "\n```",
    ),
  })),
}));
process.stdout.write(JSON.stringify({ version: 1, libraries }));
