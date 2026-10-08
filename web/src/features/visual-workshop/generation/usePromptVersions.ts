import { useCallback, useEffect, useRef, useState } from "react";
import type { VisualCanvasGenerationDraft } from "../api";

export type PromptVersion = NonNullable<
  VisualCanvasGenerationDraft["prompt_versions"]
>[number];
export type PromptVersionState = {
  prompt: string;
  prompt_versions: PromptVersion[];
  active_prompt_version_id: string;
};

function fromDraft(
  draft?: VisualCanvasGenerationDraft | null,
): PromptVersionState {
  const versions = draft?.prompt_versions?.length
    ? draft.prompt_versions
    : [{ id: "v1", name: "v1", prompt: draft?.prompt ?? "" }];
  const active = draft?.active_prompt_version_id ?? versions[0].id;
  return {
    prompt: versions.find((version) => version.id === active)?.prompt ?? "",
    prompt_versions: versions,
    active_prompt_version_id: active,
  };
}

/** Refs publish edits synchronously, including blur and submit before React renders. */
export function usePromptVersions(
  draft: VisualCanvasGenerationDraft | null | undefined,
  onChange: (next: PromptVersionState, immediate: boolean) => void,
) {
  const [state, setState] = useState(() => fromDraft(draft));
  const latest = useRef(state);
  const change = useRef(onChange);
  change.current = onChange;
  const signature = JSON.stringify(fromDraft(draft));
  useEffect(() => {
    const next = JSON.parse(signature) as PromptVersionState;
    if (JSON.stringify(latest.current) === signature) return;
    latest.current = next;
    setState(next);
  }, [signature]);

  const read = useCallback(() => latest.current, []);
  const update = useCallback(
    (
      transform: (current: PromptVersionState) => PromptVersionState,
      immediate = false,
      notify = true,
    ) => {
      const next = transform(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setState(next);
      if (notify) change.current(next, immediate);
    },
    [],
  );
  const edit = useCallback(
    (prompt: string) =>
      update((current) => ({
        ...current,
        prompt,
        prompt_versions: current.prompt_versions.map((version) =>
          version.id === current.active_prompt_version_id
            ? { ...version, prompt }
            : version,
        ),
      })),
    [update],
  );
  const select = (id: string) =>
    update((current) => {
      const version = current.prompt_versions.find((item) => item.id === id);
      return version
        ? {
            ...current,
            active_prompt_version_id: id,
            prompt: version.prompt ?? "",
          }
        : current;
    }, true);
  const add = (copy = false) =>
    update((current) => {
      if (current.prompt_versions.length >= 20) return current;
      const number =
        Math.max(
          0,
          ...current.prompt_versions.map((version) =>
            Number(/^v(\d+)$/.exec(version.name)?.[1] ?? 0),
          ),
        ) + 1;
      const version = {
        id: crypto.randomUUID(),
        name: `v${number}`,
        prompt: copy ? current.prompt : "",
      };
      return {
        prompt: version.prompt,
        prompt_versions: [...current.prompt_versions, version],
        active_prompt_version_id: version.id,
      };
    }, true);
  const rename = (id: string, name: string) =>
    update(
      (current) => ({
        ...current,
        prompt_versions: current.prompt_versions.map((version) =>
          version.id === id ? { ...version, name: name.trim() } : version,
        ),
      }),
      true,
    );
  const remove = (id: string) =>
    update((current) => {
      if (current.prompt_versions.length <= 1) return current;
      const index = current.prompt_versions.findIndex(
        (version) => version.id === id,
      );
      if (index < 0) return current;
      const versions = current.prompt_versions.filter(
        (version) => version.id !== id,
      );
      const active =
        current.active_prompt_version_id === id
          ? versions[Math.min(index, versions.length - 1)]
          : versions.find(
              (version) => version.id === current.active_prompt_version_id,
            )!;
      return {
        prompt: active.prompt ?? "",
        prompt_versions: versions,
        active_prompt_version_id: active.id,
      };
    }, true);
  return { ...state, read, update, edit, select, add, rename, remove };
}
