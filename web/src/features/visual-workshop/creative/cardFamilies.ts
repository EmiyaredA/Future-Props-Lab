import type { Card, CardKind } from "./api";

const names = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
export const compareCards = (a: Card, b: Card) =>
  names.compare(a.title, b.title) || a.id.localeCompare(b.id);
export const cardMatches = (card: Card, search: string) =>
  `${card.title}\n${card.design ?? ""}\n${card.facts ?? ""}`
    .toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase());

export function cardRoot(card: Card, byId: ReadonlyMap<string, Card>): Card {
  const visited = new Map<string, Card>();
  while (card.parent_id) {
    visited.set(card.id, card);
    const parent = byId.get(card.parent_id);
    if (!parent || parent.kind !== card.kind) break;
    if (visited.has(parent.id))
      return [...visited.values()].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    card = parent;
  }
  return card;
}

export function cardRowLabel(card: Card, byId: ReadonlyMap<string, Card>) {
  const root = cardRoot(card, byId);
  if (root.id === card.id) return { name: card.title, variant: undefined };
  const prefix = `${root.title} · `;
  const variant = card.title.startsWith(prefix)
    ? card.title.slice(prefix.length).trim()
    : card.title === root.title
      ? "变体"
      : card.title;
  return { name: root.title, variant: variant || "变体" };
}

export type CardFamily = { root: Card; items: Card[] };
export function groupCards(
  all: readonly Card[],
  entries: readonly Card[],
  sorted: boolean,
): CardFamily[] {
  const byId = new Map(all.map((card) => [card.id, card]));
  const families = new Map<string, CardFamily>();
  for (const card of entries) {
    const root = cardRoot(card, byId);
    if (!families.has(root.id)) families.set(root.id, { root, items: [] });
    families.get(root.id)!.items.push(card);
  }
  const result = [...families.values()];
  if (sorted) {
    result.sort((a, b) => compareCards(a.root, b.root));
    result.forEach((family) =>
      family.items.sort((a, b) =>
        a.id === family.root.id
          ? -1
          : b.id === family.root.id
            ? 1
            : compareCards(a, b),
      ),
    );
  }
  return result;
}

export function libraryFamilies(
  all: readonly Card[],
  kind: CardKind,
  includeArchived: boolean,
  search: string,
  sorted: boolean,
) {
  return groupCards(
    all,
    all.filter(
      (card) => card.kind === kind && (includeArchived || !card.archived),
    ),
    sorted,
  )
    .map((family) => ({
      ...family,
      items: family.items.filter(
        (card) => cardMatches(family.root, search) || cardMatches(card, search),
      ),
    }))
    .filter((family) => family.items.length > 0);
}
