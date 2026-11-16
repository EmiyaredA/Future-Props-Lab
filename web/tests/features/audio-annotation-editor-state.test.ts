import { describe, expect, it } from "vitest";
import { AnnotationEditorState } from "@features/audio-annotation/model/editorState";
import { annotationSnapshot } from "@features/audio-annotation/model/snapshot";
import type { AudioAnnotationDocument } from "@features/audio-annotation/types";

const original: AudioAnnotationDocument = {
  project_id: "project",
  schema_version: "1.0",
  revision: 0,
  speakers: [],
  custom_emotions: [],
  segments: [],
  updated_at: "2026-11-16T00:00:00Z",
};
const edit = (label: string) => ({
  ...annotationSnapshot(original),
  custom_emotions: [{ name: label, color: "#ffffff" }],
});

describe("annotation edit state", () => {
  it("keeps later edits dirty while advancing the saved CAS revision", () => {
    const editor = new AnnotationEditorState();
    editor.load(original);
    editor.replace(edit("first"));
    const submittedVersion = editor.getSnapshot().version;
    editor.replace(edit("second"));
    editor.saved({ ...original, revision: 1 }, submittedVersion);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: true,
      document: { revision: 1, custom_emotions: [{ name: "second" }] },
    });
    editor.saved({ ...original, revision: 2 }, editor.getSnapshot().version);
    expect(editor.getSnapshot().dirty).toBe(false);
  });
  it("updates document and history atomically and clears redo on a new command", () => {
    const editor = new AnnotationEditorState();
    editor.load(original);
    const observations: number[] = [];
    const stop = editor.subscribe(() =>
      observations.push(editor.getSnapshot().undo.length),
    );
    editor.replace(edit("first"));
    editor.undo();
    expect(editor.getSnapshot().document?.custom_emotions).toEqual([]);
    editor.redo();
    expect(editor.getSnapshot().document?.custom_emotions).toEqual([
      { name: "first", color: "#ffffff" },
    ]);
    editor.undo();
    editor.replace(edit("replacement"));
    expect(editor.getSnapshot().redo).toEqual([]);
    expect(observations).toEqual([1, 0, 1, 0, 1]);
    stop();
  });
  it("groups a text editing session into one undo command", () => {
    const editor = new AnnotationEditorState();
    editor.load(original);
    editor.beginTextEdit();
    editor.replace(edit("a"), false);
    editor.beginTextEdit();
    editor.replace(edit("ab"), false);
    editor.endTextEdit();
    editor.undo();
    expect(editor.getSnapshot().document?.custom_emotions).toEqual([]);
    editor.redo();
    expect(editor.getSnapshot().document?.custom_emotions).toEqual([
      { name: "ab", color: "#ffffff" },
    ]);
  });
  it("discards history on server reload and ignores older save acknowledgements", () => {
    const editor = new AnnotationEditorState();
    editor.load(original);
    editor.replace(edit("local"));
    const version = editor.getSnapshot().version;
    editor.load({ ...original, revision: 4 });
    editor.saved({ ...original, revision: 1 }, version);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      undo: [],
      redo: [],
      document: { revision: 4 },
    });
  });
});
