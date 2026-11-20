export type ReferenceSubjects = Record<string, string>;

export const subjectChoices = [
  { value: "person", label: "人" },
  { value: "hand", label: "手" },
  { value: "foot", label: "脚" },
  { value: "face", label: "脸" },
];
export const subjectLabel = (value: string) =>
  subjectChoices.find((item) => item.value === value)?.label ?? value;
export const validReferenceSubject = (value: string) =>
  value.length <= 160 &&
  /^[A-Za-z0-9 '-]+$/.test(value) &&
  /[A-Za-z]/.test(value);

export function resolveReferenceSubjects(
  saved: ReferenceSubjects | null | undefined,
  legacy: string,
  images: string[],
  keyFor: (id: string) => string,
  ready: boolean,
): ReferenceSubjects | null {
  if (saved != null) return saved;
  const targets = legacy
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!ready || !targets.length || targets.length !== images.length)
    return null;
  return Object.fromEntries(
    images.map((id, index) => [keyFor(id), targets[index]]),
  );
}

export function compileReferenceSubjects(
  bindings: ReferenceSubjects,
  images: string[],
  keyFor: (id: string) => string,
) {
  return images
    .map((id) => bindings[keyFor(id)] ?? bindings[`asset:${id}`])
    .filter(Boolean)
    .join(", ");
}
