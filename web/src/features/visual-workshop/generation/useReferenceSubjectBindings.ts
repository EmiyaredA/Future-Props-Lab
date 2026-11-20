import { useEffect, useState } from "react";
import {
  compileReferenceSubjects,
  resolveReferenceSubjects,
  type ReferenceSubjects,
} from "./referenceSubjects";
import type { ResolvedCanvasInput } from "./generationDrawerTypes";

export function useReferenceSubjectBindings({
  saved,
  legacy,
  images,
  inputs,
  ready,
  onSave,
}: {
  saved?: ReferenceSubjects | null;
  legacy: string;
  images: string[];
  inputs: ResolvedCanvasInput[];
  ready: boolean;
  onSave: (value: ReferenceSubjects, subject: string) => void;
}) {
  const [local, setLocal] = useState<ReferenceSubjects | null>(saved ?? null);
  useEffect(() => setLocal(saved ?? null), [saved]);
  const subjectKey = (id: string) =>
    inputs.find((input) => input.kind === "image" && input.assetId === id)
      ?.key ?? `asset:${id}`;
  const referenceSubjects = resolveReferenceSubjects(
    local,
    legacy,
    images,
    subjectKey,
    ready,
  );
  const effectiveSubject =
    referenceSubjects === null
      ? legacy
      : compileReferenceSubjects(referenceSubjects, images, subjectKey);
  const replaceReferenceSubjects = (next: ReferenceSubjects) => {
    setLocal(next);
    onSave(next, compileReferenceSubjects(next, images, subjectKey));
  };
  const changeReferenceSubject = (id: string, target: string) => {
    const next = { ...(referenceSubjects ?? {}) };
    delete next[`asset:${id}`];
    if (target) next[subjectKey(id)] = target;
    else delete next[subjectKey(id)];
    replaceReferenceSubjects(next);
  };
  return {
    referenceSubjects,
    effectiveSubject,
    subjectKey,
    replaceReferenceSubjects,
    changeReferenceSubject,
  };
}
