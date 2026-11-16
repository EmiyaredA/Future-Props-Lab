import type { AnnotationSnapshot, AudioAnnotationDocument } from "../types";
import { annotationSnapshot } from "./snapshot";

export type AnnotationEditState = {
  document: AudioAnnotationDocument | null;
  version: number;
  dirty: boolean;
  undo: AnnotationSnapshot[];
  redo: AnnotationSnapshot[];
};

/** Owns draft/history as one transition; async consumers never receive setters. */
export class AnnotationEditorState {
  constructor(
    readonly scope: { accountId: string; projectId: string } | null = null,
  ) {}
  private state: AnnotationEditState = {
    document: null,
    version: 0,
    dirty: false,
    undo: [],
    redo: [],
  };
  private listeners = new Set<() => void>();
  private textBase: AnnotationSnapshot | null = null;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AnnotationEditState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  load(document: AudioAnnotationDocument) {
    if (this.scope && document.project_id !== this.scope.projectId)
      throw new Error("标注文档不属于当前项目");
    this.textBase = null;
    this.publish({
      document,
      version: this.state.version + 1,
      dirty: false,
      undo: [],
      redo: [],
    });
  }
  replace(next: AnnotationSnapshot, record = true) {
    if (record) this.endTextEdit();
    const current = this.state;
    if (!current.document) return false;
    this.publish({
      ...current,
      document: { ...current.document, ...next },
      version: current.version + 1,
      dirty: true,
      undo: record
        ? [...current.undo, annotationSnapshot(current.document)].slice(-100)
        : current.undo,
      redo: [],
    });
    return true;
  }
  beginTextEdit() {
    if (!this.textBase && this.state.document)
      this.textBase = annotationSnapshot(this.state.document);
  }
  endTextEdit() {
    if (!this.textBase) return;
    this.publish({
      ...this.state,
      undo: [...this.state.undo, this.textBase].slice(-100),
      redo: [],
    });
    this.textBase = null;
  }
  undo() {
    this.travel("undo", "redo");
  }
  redo() {
    this.travel("redo", "undo");
  }
  private travel(from: "undo" | "redo", to: "undo" | "redo") {
    this.endTextEdit();
    const current = this.state;
    const next = current[from].at(-1);
    if (!current.document || !next) return;
    this.publish({
      ...current,
      document: { ...current.document, ...next },
      dirty: true,
      version: current.version + 1,
      [from]: current[from].slice(0, -1),
      [to]: [...current[to], annotationSnapshot(current.document)].slice(-100),
    });
  }
  saved(document: AudioAnnotationDocument, version: number) {
    if (this.scope && document.project_id !== this.scope.projectId) return;
    if (
      !this.state.document ||
      document.revision < this.state.document.revision
    )
      return;
    // Acknowledging an older save advances CAS without replacing newer edits.
    this.publish({
      ...this.state,
      document: {
        ...this.state.document,
        revision: document.revision,
        updated_at: document.updated_at,
      },
      dirty: this.state.version !== version,
    });
  }
  discard() {
    this.publish({ ...this.state, dirty: false });
  }
}
