import { createUploadTransfer } from "@platform/api/transfer";
import { type TransferOptions } from "@platform/api/transfer";
import type { components, paths } from "@generated/api";
import { api, unwrap, fetchApiBlob } from "@platform/api/client";

export type Note = components["schemas"]["ThoughtNoteOut"];
export type LinkPreview = components["schemas"]["ThoughtLinkPreview"];
export async function getLinkPreview(
  url: string,
  signal: AbortSignal,
): Promise<LinkPreview> {
  try {
    return await read(
      async (requestSignal) =>
        unwrap(
          await api.GET("/v1/thought-workshop/link-preview", {
            params: { query: { url } },
            signal: requestSignal,
          }),
        ),
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      url,
      final_url: url,
      domain: new URL(url).hostname,
      title: null,
      description: null,
      available: false,
    };
  }
}
export type NoteSummary = components["schemas"]["ThoughtNoteSummary"];
export type NoteInput = Omit<
  components["schemas"]["ThoughtNotePut"],
  "expected_revision" | "kind"
> & { kind?: "note" | "multitable" };
export type KnowledgeBase = components["schemas"]["KnowledgeBaseOut"];
export type NoteQuery = NonNullable<
  paths["/v1/thought-workshop/notes"]["get"]["parameters"]["query"]
>;
export async function read<T>(
  request: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  try {
    return await request(signal ? AbortSignal.any([signal, timeout]) : timeout);
  } catch (error) {
    if (timeout.aborted)
      throw new Error("服务响应超时，请确认后端服务正常后重试。");
    throw error;
  }
}
export const listNotes = (query: NoteQuery, signal?: AbortSignal) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET("/v1/thought-workshop/notes", {
          params: { query },
          signal,
        }),
      ),
    signal,
  );
export const getNote = (id: string, signal?: AbortSignal) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET("/v1/thought-workshop/notes/{note_id}", {
          params: { path: { note_id: id } },
          signal,
        }),
      ),
    signal,
  );
export const createNote = async (body: NoteInput) => {
  const project = await unwrap(
    await api.GET("/v1/thought-workshop/knowledge-bases/{project_id}", {
      params: { path: { project_id: body.knowledge_base_id } },
    }),
  );
  return unwrap(
    await api.POST("/v1/thought-workshop/notes", {
      body: {
        ...body,
        kind: body.kind ?? "note",
        expected_knowledge_revision: project.revision,
      },
    }),
  );
};
export const saveNote = async (id: string, body: NoteInput, revision: number) =>
  unwrap(
    await api.PUT("/v1/thought-workshop/notes/{note_id}", {
      params: { path: { note_id: id } },
      body: { ...body, kind: body.kind ?? "note", expected_revision: revision },
    }),
  );
export const deleteNote = async (
  note: NoteSummary,
  permanent = false,
  cascadeChildren = false,
) => {
  const project = await unwrap(
    await api.GET("/v1/thought-workshop/knowledge-bases/{project_id}", {
      params: { path: { project_id: note.knowledge_base_id } },
    }),
  );
  return unwrap(
    await api.DELETE("/v1/thought-workshop/notes/{note_id}", {
      params: {
        path: { note_id: note.id },
        query: {
          expected_revision: note.revision,
          expected_knowledge_revision: project.revision,
          permanent,
          cascade_children: cascadeChildren,
        },
      },
    }),
  );
};
export const restoreNote = async (note: NoteSummary) => {
  const project = await unwrap(
    await api.GET("/v1/thought-workshop/knowledge-bases/{project_id}", {
      params: { path: { project_id: note.knowledge_base_id } },
    }),
  );
  return unwrap(
    await api.POST("/v1/thought-workshop/notes/{note_id}/restore", {
      params: { path: { note_id: note.id } },
      body: {
        expected_revision: note.revision,
        expected_knowledge_revision: project.revision,
      },
    }),
  );
};
type UploadTransferOptions = TransferOptions & { requestId?: string };

export async function uploadImage(
  file: File,
  transfer: UploadTransferOptions = {},
) {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return unwrap(
    await api.POST("/v1/thought-workshop/images", {
      headers: { "Idempotency-Key": transfer.requestId ?? crypto.randomUUID() },
      fetch: uploadTransfer.fetch,
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.set("upload", file);
        return uploadTransfer.capture(form);
      },
    }),
  );
}
export async function uploadAttachment(
  file: File,
  transfer: UploadTransferOptions = {},
) {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return unwrap(
    await api.POST("/v1/thought-workshop/attachments", {
      headers: { "Idempotency-Key": transfer.requestId ?? crypto.randomUUID() },
      fetch: uploadTransfer.fetch,
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.set("upload", file);
        return uploadTransfer.capture(form);
      },
    }),
  );
}
export async function importArchive(
  file: File,
  project?: KnowledgeBase,
  transfer: TransferOptions = {},
) {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return unwrap(
    await api.POST("/v1/thought-workshop/imports", {
      fetch: uploadTransfer.fetch,
      params: {
        query: project
          ? {
              knowledge_base_id: project.id,
              expected_revision: project.revision,
            }
          : {},
      },
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.set("upload", file);
        return uploadTransfer.capture(form);
      },
    }),
  );
}
export const downloadBackup = (id?: string) =>
  fetchApiBlob(
    "/v1/thought-workshop/backup" +
      (id ? `?knowledge_base_id=${encodeURIComponent(id)}` : ""),
  );

export function noteInput(note: Note): NoteInput {
  const {
    title,
    knowledge_base_id,
    parent_id,
    schema_version,
    document,
    tags,
    pinned,
    favorite,
  } = note;
  return {
    title,
    knowledge_base_id,
    parent_id,
    schema_version,
    document,
    tags,
    pinned,
    favorite,
  };
}
