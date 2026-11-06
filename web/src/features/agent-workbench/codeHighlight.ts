import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";

const highlighter = createLowlight(common);
const languages: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  lua: "lua",
  pl: "perl",
  r: "r",
  diff: "diff",
  patch: "diff",
};

export function fileLanguage(path: string): string | undefined {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (["makefile", "gnumakefile"].includes(name)) return "makefile";
  return languages[name.split(".").at(-1) ?? ""];
}

export function highlightCode(
  text: string,
  language?: string,
  limit = 128 * 1024,
): RootContent[] {
  if (language && text.length <= limit && highlighter.registered(language)) {
    try {
      return highlighter.highlight(language, text).children;
    } catch {
      /* Unrecognized syntax must never prevent reading the original file. */
    }
  }
  return [{ type: "text", value: text }];
}

export type CodeToken = { text: string; className: string };

// Highlight the complete document first, then split token text into lines.
// This keeps multiline strings/comments intact without altering source text.
export function highlightLines(text: string, language?: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  function visit(nodes: RootContent[], classes: string[] = []) {
    for (const node of nodes) {
      if (node.type === "element") {
        const own = node.properties.className;
        visit(node.children, [
          ...classes,
          ...(Array.isArray(own) ? own.map(String) : []),
        ]);
      } else if (node.type === "text") {
        node.value.split("\n").forEach((part, index) => {
          if (index) lines.push([]);
          if (part)
            lines[lines.length - 1].push({
              text: part,
              className: classes.join(" "),
            });
        });
      }
    }
  }
  visit(highlightCode(text, language));
  return lines;
}
