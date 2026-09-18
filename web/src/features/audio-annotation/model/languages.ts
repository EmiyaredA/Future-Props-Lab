import type {
  AudioAnnotationSegment,
  AudioAnnotationTranscriptionOption,
} from "@features/audio-annotation/types";

export const ANNOTATION_LANGUAGES = [
  { code: "zh", label: "中文", color: "teal" },
  { code: "ja", label: "日语", color: "purple" },
  { code: "en", label: "英语", color: "blue" },
  { code: "ko", label: "韩语", color: "yellow" },
] as const;

export const PRIMARY_DISPLAY_LANGUAGE = "primary";
const DISPLAY_LANGUAGE_STORAGE_PREFIX =
  "future_props_audio_annotation_display_language";

export function preferredDisplayLanguageStorageKey(projectId: string): string {
  return `${DISPLAY_LANGUAGE_STORAGE_PREFIX}:${projectId}`;
}

export function loadPreferredDisplayLanguage(
  projectId: string,
  storage: Pick<Storage, "getItem">,
): string | null {
  const stored = storage.getItem(preferredDisplayLanguageStorageKey(projectId));
  if (stored === PRIMARY_DISPLAY_LANGUAGE) return stored;
  return ANNOTATION_LANGUAGES.some((language) => language.code === stored)
    ? stored
    : null;
}

export function storePreferredDisplayLanguage(
  projectId: string,
  language: string,
  storage: Pick<Storage, "setItem">,
): void {
  storage.setItem(preferredDisplayLanguageStorageKey(projectId), language);
}

export function languageLabel(code: string): string {
  return (
    ANNOTATION_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}

export function languageColor(code: string): string {
  return (
    ANNOTATION_LANGUAGES.find((language) => language.code === code)?.color ??
    "neutral"
  );
}

export function segmentLanguageCodes(
  segment: Pick<AudioAnnotationSegment, "language" | "localized_texts">,
): string[] {
  return [
    ...new Set([
      ...(segment.language ? [segment.language] : []),
      ...(segment.localized_texts ?? []).map((item) => item.language),
    ]),
  ];
}

export function segmentDisplayText(
  segment: Pick<
    AudioAnnotationSegment,
    "language" | "localized_texts" | "text"
  >,
  preferredLanguage: string,
): string {
  if (preferredLanguage !== PRIMARY_DISPLAY_LANGUAGE) {
    if (
      segment.language === preferredLanguage &&
      segment.text.trim().length > 0
    )
      return segment.text;
    const preferred = (segment.localized_texts ?? []).find(
      (item) =>
        item.language === preferredLanguage && item.text.trim().length > 0,
    );
    if (preferred) return preferred.text;
  }
  if (segment.text.trim().length > 0) return segment.text;
  return (
    (segment.localized_texts ?? []).find((item) => item.text.trim().length > 0)
      ?.text ?? ""
  );
}

export function segmentEditorVersion(
  segment: Pick<AudioAnnotationSegment, "language" | "localized_texts">,
  preferredLanguage: string,
): string {
  if (
    preferredLanguage === PRIMARY_DISPLAY_LANGUAGE ||
    segment.language === preferredLanguage
  )
    return PRIMARY_DISPLAY_LANGUAGE;
  return (segment.localized_texts ?? []).some(
    (item) => item.language === preferredLanguage,
  )
    ? preferredLanguage
    : PRIMARY_DISPLAY_LANGUAGE;
}

const TRANSCRIPTION_LANGUAGE_ALIASES: Record<string, string[]> = {
  zh: ["zh", "chinese"],
  en: ["en", "english"],
  ja: ["ja", "japanese"],
  ko: ["ko", "korean"],
  fr: ["fr", "french"],
  de: ["de", "german"],
  es: ["es", "spanish"],
  pt: ["pt", "portuguese"],
};

export function transcriptionLanguageMatch(
  option: AudioAnnotationTranscriptionOption | undefined,
  languageTag: string | null,
): { value: string; label: string; fallback: boolean } {
  const languageOptions = option?.parameter_capabilities.language_options ?? [];
  const matched = matchTranscriptionLanguage(languageOptions, languageTag);
  if (matched) return { ...matched, fallback: false };
  const automatic = languageOptions.find(
    (item) => item.value.toLocaleLowerCase() === "auto",
  );
  return {
    value: automatic?.value ?? "auto",
    label: automatic?.label ?? "自动识别",
    fallback: true,
  };
}

export function transcriptionTargetLanguageMatch(
  option: AudioAnnotationTranscriptionOption | undefined,
  languageTag: string | null,
): { value: string; label: string } | null {
  return matchTranscriptionLanguage(
    option?.parameter_capabilities.target_language_options ?? [],
    languageTag,
  );
}

function matchTranscriptionLanguage(
  languageOptions: { value: string; label: string }[],
  languageTag: string | null,
): { value: string; label: string } | null {
  const values = new Map(
    languageOptions.map((item) => [item.value.toLocaleLowerCase(), item]),
  );
  const normalized = languageTag?.trim().replaceAll("_", "-").toLowerCase();
  const primary = normalized?.split("-", 1)[0] ?? "";
  const candidates = [
    normalized,
    primary,
    ...(TRANSCRIPTION_LANGUAGE_ALIASES[primary] ?? []),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const matched = values.get(candidate.toLocaleLowerCase());
    if (matched) return { value: matched.value, label: matched.label };
  }
  return null;
}

export function segmentSearchableText(segment: AudioAnnotationSegment): string {
  return [
    segment.text,
    ...(segment.localized_texts ?? []).map((item) => item.text),
  ].join(" ");
}
