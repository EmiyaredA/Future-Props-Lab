import { api, unwrap, fetchApiDownload } from "@platform/api/client";
import type { components } from "@generated/api";

export type Room = components["schemas"]["InterviewRoomOut"];
export type PreparationTask = components["schemas"]["InterviewTaskOut"];
export type Bundle = components["schemas"]["PreparationBundle"];
export type ExecutorStatus = components["schemas"]["InterviewExecutorOut"];
export type PrepareInput = components["schemas"]["InterviewPrepareIn"];

export const interviewDate = (value: string) =>
  new Date(/([zZ]|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);

export const interviewApi = {
  executor: () => api.GET("/v1/interview-assistant/executor").then(unwrap),
  rooms: () => api.GET("/v1/interview-assistant/rooms").then(unwrap),
  room: (room_id: string) =>
    api
      .GET("/v1/interview-assistant/rooms/{room_id}", {
        params: { path: { room_id } },
      })
      .then(unwrap),
  create: (title: string, request_id: string) =>
    api
      .POST("/v1/interview-assistant/rooms", {
        body: { title, request_id },
      })
      .then(unwrap),
  upload: (room: Room, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api
      .POST("/v1/interview-assistant/rooms/{room_id}/materials", {
        params: {
          path: { room_id: room.id },
          query: { expected_revision: room.revision },
        },
        body: { file: "" },
        bodySerializer: () => body,
      })
      .then(unwrap);
  },
  prepare: (room_id: string, body: PrepareInput) =>
    api
      .POST("/v1/interview-assistant/rooms/{room_id}/preparations", {
        params: { path: { room_id } },
        body,
      })
      .then(unwrap),
  cancel: (room_id: string, task: PreparationTask) =>
    api
      .POST(
        "/v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/cancel",
        {
          params: { path: { room_id, task_id: task.id } },
          body: { expected_revision: task.revision },
        },
      )
      .then(unwrap),
  remove: (room: Room) =>
    api
      .DELETE("/v1/interview-assistant/rooms/{room_id}", {
        params: {
          path: { room_id: room.id },
          query: { expected_revision: room.revision },
        },
      })
      .then(unwrap),
  bundle: (room_id: string, task_id: string) =>
    api
      .GET(
        "/v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/bundle",
        {
          params: { path: { room_id, task_id } },
        },
      )
      .then(unwrap),
  progress: (room_id: string, task_id: string) =>
    api
      .GET(
        "/v1/interview-assistant/rooms/{room_id}/preparations/{task_id}/events",
        {
          params: { path: { room_id, task_id } },
        },
      )
      .then(unwrap),
  export: (room_id: string, task_id: string, format: "json" | "markdown") =>
    fetchApiDownload(
      `/v1/interview-assistant/rooms/${encodeURIComponent(room_id)}/preparations/${encodeURIComponent(task_id)}/export?format=${format}`,
    ),
};

export const activeTask = (task?: PreparationTask | null) =>
  !!task && ["queued", "running", "validating"].includes(task.status);
export const statusLabel: Record<PreparationTask["status"], string> = {
  queued: "排队中",
  running: "Codex 准备中",
  validating: "校验交付中",
  succeeded: "资料已就绪",
  needs_input: "需要补充／重新准备",
  failed: "准备失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
