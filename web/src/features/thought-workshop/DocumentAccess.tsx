import { createContext, useContext, type ReactNode } from "react";
import { getDirectory } from "./knowledgeApi";
import type { DirectoryEntry } from "./document-layout/model";
import {
  uploadAttachment,
  uploadImage,
  saveNote,
  createNote,
  type NoteInput,
} from "./api";
import {
  resolveReferences,
  globalSearch,
  listBacklinks,
} from "./knowledge-tools/api";

export type DocumentAccess = {
  namespace: string;
  publicationId?: string;
  currentNoteId?: string;
  community: boolean;
  canViewHistory: boolean;
  assetUrl: (id: string) => string;
  uploadImage: typeof uploadImage;
  uploadAttachment: typeof uploadAttachment;
  save: typeof saveNote;
  duplicate?: (body: NoteInput) => ReturnType<typeof createNote>;
  resolveReferences: typeof resolveReferences;
  searchNotes: typeof globalSearch;
  backlinks: typeof listBacklinks;
  referenceHref: (note: string, library: string) => string;
  directory?: (
    library: string,
    signal?: AbortSignal,
  ) => Promise<DirectoryEntry[]>;
};
const ordinary: DocumentAccess = {
  namespace: "workspace",
  directory: async (library, signal) =>
    (await getDirectory(library, signal)).documents,
  community: false,
  canViewHistory: true,
  assetUrl: (id) => `/v1/files/${encodeURIComponent(id)}/content`,
  uploadImage: (...args) => uploadImage(...args),
  uploadAttachment: (...args) => uploadAttachment(...args),
  save: (...args) => saveNote(...args),
  duplicate: (...args) => createNote(...args),
  resolveReferences: (...args) => resolveReferences(...args),
  searchNotes: (...args) => globalSearch(...args),
  backlinks: (...args) => listBacklinks(...args),
  referenceHref: (note, library) =>
    `/apps/thought-workshop/knowledge-bases/${encodeURIComponent(library)}/documents/${encodeURIComponent(note)}`,
};
const Access = createContext<DocumentAccess>(ordinary);
export function DocumentAccessProvider({
  value,
  children,
}: {
  value: DocumentAccess;
  children: ReactNode;
}) {
  return <Access.Provider value={value}>{children}</Access.Provider>;
}
// The editor and its React node views consume this explicit access adapter together.
// eslint-disable-next-line react-refresh/only-export-components
export const useDocumentAccess = () => useContext(Access);
