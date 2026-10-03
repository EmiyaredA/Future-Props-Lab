/** A bounded prefix, never a second model request or a suffix of the reply. */
export function bubblePreview(content: string, limit = 120) {
  const characters = Array.from(content.trim());
  if (characters.length <= limit)
    return { text: characters.join(""), truncated: false };
  const prefix = characters.slice(0, limit).join("");
  const endings = [...prefix.matchAll(/[。！？!?\n]|\.(?=\s|$)/g)];
  const last = endings.at(-1);
  const text = last ? prefix.slice(0, last.index! + last[0].length) : prefix;
  return { text: text.trimEnd(), truncated: true };
}
