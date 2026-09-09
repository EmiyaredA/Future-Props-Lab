import type { components, paths } from "@generated/api";
import { api, unwrap, requestApi, fetchApiBlob } from "@platform/api/client";

export type Note = components["schemas"]["ThoughtNoteOut"];
export type NoteSummary = components["schemas"]["ThoughtNoteSummary"];
export type NoteInput = Omit<
  components["schemas"]["ThoughtNotePut"],
  "expected_revision"
>;
export type KnowledgeBase = components["schemas"]["KnowledgeBaseOut"];
export type AssistantInput = components["schemas"]["ThoughtAssistantIn"];
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
      body: { ...body, expected_knowledge_revision: project.revision },
    }),
  );
};
export const saveNote = async (id: string, body: NoteInput, revision: number) =>
  unwrap(
    await api.PUT("/v1/thought-workshop/notes/{note_id}", {
      params: { path: { note_id: id } },
      body: { ...body, expected_revision: revision },
    }),
  );
export const deleteNote = async (note: NoteSummary, permanent = false) => {
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
export const listWritingModels = (signal?: AbortSignal) =>
  read(
    async (signal) =>
      unwrap(await api.GET("/v1/thought-workshop/models", { signal })),
    signal,
  );

export async function uploadImage(file: File) {
  return unwrap(
    await api.POST("/v1/thought-workshop/images", {
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.set("upload", file);
        return form;
      },
    }),
  );
}
export async function uploadAttachment(file: File) {
  return unwrap(
    await api.POST("/v1/thought-workshop/attachments", {
      body: { upload: file as unknown as string },
      bodySerializer() {
        const form = new FormData();
        form.set("upload", file);
        return form;
      },
    }),
  );
}
export async function importArchive(file: File, project?: KnowledgeBase) {
  return unwrap(
    await api.POST("/v1/thought-workshop/imports", {
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
        return form;
      },
    }),
  );
}
export const downloadBackup = (id?: string) =>
  fetchApiBlob(
    "/v1/thought-workshop/backup" +
      (id ? `?knowledge_base_id=${encodeURIComponent(id)}` : ""),
  );

export async function writeWithAI(
  id: string,
  body: AssistantInput,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const response = await requestApi(
    `/v1/thought-workshop/notes/${encodeURIComponent(id)}/assistant`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!response.body) throw new Error("模型响应为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const raw = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!raw) continue;
        const event = JSON.parse(raw) as {
          type: string;
          text?: string;
          message?: string;
        };
        if (event.type === "error")
          throw new Error(event.message || "生成失败");
        if (event.type === "delta") onText(event.text || "");
        if (event.type === "complete") complete = true;
      }
      if (done) break;
    }
    if (!complete) throw new Error("生成中断，可保留已生成的文字并重试");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function noteInput(note: Note): NoteInput {
  const {
    title,
    knowledge_base_id,
    folder_id,
    schema_version,
    document,
    tags,
    pinned,
    favorite,
  } = note;
  return {
    title,
    knowledge_base_id,
    folder_id,
    schema_version,
    document,
    tags,
    pinned,
    favorite,
  };
}
