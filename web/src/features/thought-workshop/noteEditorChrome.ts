import type { Note } from "./api";
import type { SaveState } from "./useNoteDraft";

export type NoteEditorChrome = {
  state: SaveState;
  savedAt: string;
  save: () => Promise<Note>;
  openHistory: () => void;
  exportNote: (format: string) => void;
  canSave: boolean;
  canOpenHistory: boolean;
};
