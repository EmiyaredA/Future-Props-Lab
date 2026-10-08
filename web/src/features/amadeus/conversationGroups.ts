import { dateGroup, type Conversation } from "./protocol";

export function groupConversations(
  conversations: Conversation[],
  search: string,
  editingId?: string,
) {
  const filtered = conversations.filter(
    (item) =>
      item.id === editingId ||
      item.title.toLowerCase().includes(search.toLowerCase()),
  );
  return ["今天", "昨天", "更早"]
    .map((name) => ({
      name,
      items: filtered.filter((item) => dateGroup(item.updated_at) === name),
    }))
    .filter((group) => group.items.length);
}
