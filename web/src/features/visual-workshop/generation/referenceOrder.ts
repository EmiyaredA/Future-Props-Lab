/** Saved order wins; newly connected assets are appended without moving existing ones. */
export function orderedReferenceIds(value: string[], linked: string[] = []) {
  return [...new Set([...value, ...linked])];
}

export function moveReference(ids: string[], from: string, to: string) {
  const source = ids.indexOf(from);
  const destination = ids.indexOf(to);
  if (source < 0 || destination < 0 || source === destination) return ids;
  const next = [...ids];
  next.splice(source, 1);
  next.splice(destination, 0, from);
  return next;
}

/** Renumber in one pass so swaps never cascade into each other. */
export function reorderPictureReferences(
  prompt: string,
  previous: string[],
  next: string[],
) {
  const positions = new Map(next.map((id, index) => [id, index + 1]));
  return prompt.replace(/<Picture\s+(\d+)>/g, (token, number: string) => {
    const position = positions.get(previous[Number(number) - 1]);
    return position ? `<Picture ${position}>` : token;
  });
}
