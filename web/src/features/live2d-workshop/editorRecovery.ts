import { getDocument } from "./api";
import type { CharacterDocument } from "./types";

type Ref<T> = { current: T };

export async function restoreSavedDocument({
  projectId,
  documentRef,
  revision,
  version,
  savedVersion,
  history,
  future,
  setDoc,
  setDirty,
  setConflict,
}: {
  projectId: string;
  documentRef: Ref<CharacterDocument | null>;
  revision: Ref<number>;
  version: Ref<number>;
  savedVersion: Ref<number>;
  history: Ref<CharacterDocument[]>;
  future: Ref<CharacterDocument[]>;
  setDoc: (value: CharacterDocument) => void;
  setDirty: (value: boolean) => void;
  setConflict: (value: boolean) => void;
}): Promise<void> {
  const response = await getDocument(projectId);
  const document = response.document as CharacterDocument;
  documentRef.current = document;
  setDoc(document);
  revision.current = response.revision;
  version.current++;
  savedVersion.current = version.current;
  setDirty(false);
  setConflict(false);
  history.current = [];
  future.current = [];
}
