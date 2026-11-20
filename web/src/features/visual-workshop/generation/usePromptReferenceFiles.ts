import { useCallback, useMemo, useState } from "react";
import type { ManagedFile } from "@features/files";
import {
  promptAssetReferenceNameForBase,
  type PromptManagedFile,
} from "./generationPromptModel";

export function usePromptReferenceFiles(
  selectedPromptAssetIds: string[],
  linkedReferenceNames: Record<string, string>,
  promptReferenceNames: Record<string, string>,
) {
  const [promptFiles, setPromptFiles] = useState<Record<string, ManagedFile>>(
    {},
  );
  const rememberPromptFiles = useCallback((files: ManagedFile[]) => {
    setPromptFiles((current) => {
      let changed = false;
      const next = { ...current };
      files.forEach((file) => {
        if (next[file.id] !== file) {
          next[file.id] = file;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);
  const resolvedLinkedReferenceNames = useMemo(() => {
    const names: Record<string, string> = {};
    Object.entries(linkedReferenceNames).forEach(([assetId, baseName]) => {
      const file = promptFiles[assetId];
      if (file)
        names[assetId] = promptAssetReferenceNameForBase(file, baseName);
    });
    return names;
  }, [linkedReferenceNames, promptFiles]);
  const promptAssets = useMemo(
    () =>
      selectedPromptAssetIds.flatMap((id) => {
        const file = promptFiles[id];
        if (!file) return [];
        const referenceName =
          resolvedLinkedReferenceNames[id] ?? promptReferenceNames[id];
        if (!referenceName) return [file];
        return [
          {
            ...file,
            prompt_reference_name: referenceName,
            prompt_legacy_names: promptReferenceNames[id]
              ? [promptReferenceNames[id]]
              : [],
          } satisfies PromptManagedFile,
        ];
      }),
    [
      promptFiles,
      promptReferenceNames,
      resolvedLinkedReferenceNames,
      selectedPromptAssetIds,
    ],
  );
  return {
    promptFiles,
    rememberPromptFiles,
    resolvedLinkedReferenceNames,
    promptAssets,
  };
}
