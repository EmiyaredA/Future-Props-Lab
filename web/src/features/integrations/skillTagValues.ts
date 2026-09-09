export function parseSkillTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}
