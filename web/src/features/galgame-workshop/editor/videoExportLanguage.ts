import type { GalgameStoryProject } from "@features/galgame-workshop/api";

export function videoExportLanguageOptions(document: GalgameStoryProject) {
  return Array.from(
    new Set([
      document.localizations?.sourceLocale ?? "zh",
      ...(document.localizations?.targets ?? []).map((target) => target.locale),
    ]),
  );
}
