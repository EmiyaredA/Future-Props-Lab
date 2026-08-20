const CHARACTER_COLORS = [
  "#6d8dff",
  "#d36cff",
  "#ff7b8b",
  "#f4a84d",
  "#4ec9a4",
  "#4aaee8",
  "#b5c94c",
  "#df72b0",
];

export function timelineCharacterColor(characterId: string) {
  let hash = 0;
  for (const character of characterId)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return CHARACTER_COLORS[Math.abs(hash) % CHARACTER_COLORS.length];
}
