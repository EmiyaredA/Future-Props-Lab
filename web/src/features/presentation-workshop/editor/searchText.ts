import type { Deck, TextRun } from "../types";
const pattern = (query: string, caseSensitive: boolean) =>
  new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    caseSensitive ? "g" : "gi",
  );

export function replaceRuns(
  runs: TextRun[],
  query: string,
  replacement: string,
  caseSensitive = false,
): TextRun[] {
  if (!query) return runs;
  const text = runs.map((r) => r.text).join("");
  const expression = pattern(query, caseSensitive);
  const matches = [...text.matchAll(expression)];
  if (!matches.length) return runs;
  const result: TextRun[] = [];
  let position = 0;
  const intervals = runs.map((run) => {
    const start = position;
    position += run.text.length;
    return { run, start };
  });
  const append = (run: TextRun, value: string) => {
    if (!value) return;
    const previous = result.at(-1);
    if (
      previous &&
      JSON.stringify({ ...previous, text: "" }) ===
        JSON.stringify({ ...run, text: "" })
    )
      previous.text += value;
    else result.push({ ...run, text: value });
  };
  const slice = (from: number, to: number) => {
    for (const { run, start } of intervals) {
      const value = run.text.slice(
        Math.max(0, from - start),
        Math.max(0, Math.min(run.text.length, to - start)),
      );
      if (start < to && start + run.text.length > from) append(run, value);
    }
  };
  let cursor = 0;
  for (const match of matches) {
    const start = match.index!;
    slice(cursor, start);
    append(
      intervals.find(
        (item) =>
          start >= item.start && start < item.start + item.run.text.length,
      )?.run ?? runs[0],
      replacement,
    );
    cursor = start + match[0].length;
  }
  slice(cursor, text.length);
  return result.length ? result : [{ ...runs[0], text: "" }];
}

export function searchDeck(deck: Deck, query: string, caseSensitive = false) {
  if (!query) return [];
  const expression = pattern(query, caseSensitive),
    results: { slideId: string; elementId?: string; text: string }[] = [];
  const contains = (text: string) => {
    expression.lastIndex = 0;
    return expression.test(text);
  };
  for (const slide of deck.slides) {
    if (contains(slide.notes))
      results.push({ slideId: slide.id, text: slide.notes.slice(0, 160) });
    for (const element of slide.elements) {
      const text =
        element.paragraphs
          .map((p) => p.runs.map((r) => r.text).join(""))
          .join("\n") ||
        element.table?.rows
          .map((row) => row.map((c) => c.text).join(" "))
          .join("\n") ||
        "";
      if (contains(text))
        results.push({
          slideId: slide.id,
          elementId: element.id,
          text: text.slice(0, 160),
        });
    }
    if (results.length >= 200) break;
  }
  return results.slice(0, 200);
}

export function replaceInDeck(
  deck: Deck,
  query: string,
  replacement: string,
  caseSensitive = false,
): Deck {
  if (!query) return deck;
  const replace = (text: string) =>
    text.replace(pattern(query, caseSensitive), () => replacement);
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      const notes_rich = slide.notes_rich?.map((p) => ({
        ...p,
        runs: replaceRuns(p.runs, query, replacement, caseSensitive),
      }));
      return {
        ...slide,
        notes: notes_rich
          ? notes_rich.map((p) => p.runs.map((r) => r.text).join("")).join("\n")
          : replace(slide.notes),
        ...(notes_rich ? { notes_rich } : {}),
        elements: slide.elements.map((element) =>
          element.locked
            ? element
            : {
                ...element,
                paragraphs: element.paragraphs.map((p) => ({
                  ...p,
                  runs: replaceRuns(p.runs, query, replacement, caseSensitive),
                })),
                ...(element.table
                  ? {
                      table: {
                        ...element.table,
                        rows: element.table.rows.map((row) =>
                          row.map((cell) => ({
                            ...cell,
                            text: replace(cell.text),
                          })),
                        ),
                      },
                    }
                  : {}),
              },
        ),
      };
    }),
  };
}
