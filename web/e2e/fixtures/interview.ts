import type { Page } from "@playwright/test";
import {
  interviewBundle,
  interviewRoom,
  interviewTask,
} from "../../tests/helpers/interview";
import type {
  Room,
  PreparationTask,
} from "../../src/features/interview-assistant/api";

/** Deterministic protocol fixture. Live CLI is separately tested with fictional originals. */
export async function mockInterviewPreparation(
  page: Page,
  options: { incomplete?: boolean } = {},
) {
  const rooms = new Map<string, Room>();
  const polls = new Map<string, number>();
  let count = 0;
  let sequence = 0;
  let uploadedName = "";
  await page.route("**/v1/interview-assistant/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/v1/interview-assistant/", "");
    const parts = path.split("/");
    const room = rooms.get(parts[1]);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === "executor")
      return json({
        available: true,
        code: "ready",
        version: "0.163.0",
        message: "本机 Codex 可用 · 确定性测试执行器",
      });
    if (path === "rooms" && request.method() === "GET")
      return json({ items: [...rooms.values()].reverse() });
    if (path === "rooms") {
      const body = request.postDataJSON();
      const result = {
        ...interviewRoom(),
        id: `room-${++count}`,
        title: body.title,
      };
      rooms.set(result.id, result);
      return json(result, 201);
    }
    if (!room) return json({ detail: "not_found" }, 404);
    if (parts.length === 2) {
      if (request.method() === "DELETE") {
        rooms.delete(room.id);
        return json({ deleted: true });
      }
      return json(room);
    }
    if (parts[2] === "materials" && request.method() === "POST") {
      uploadedName =
        request
          .postDataBuffer()
          ?.toString()
          .match(/filename="([^"]+)"/)?.[1] || "resume.docx";
      room.revision++;
      room.materials.push({
        id: `material-${sequence + 1}`,
        filename: uploadedName,
        sha256: "test-sha256",
        size: 100,
        created_at: new Date().toISOString(),
      });
      return json(room);
    }
    if (parts[2] === "preparations" && parts.length === 3) {
      const body = request.postDataJSON();
      const id = `task-${++sequence}`;
      const task: PreparationTask = {
        ...interviewTask("queued", id),
        room_id: room.id,
        input_version: room.input_version + 1,
        revision: 0,
        events: [],
        snapshot: {
          ...body,
          material: body.material_id
            ? { id: body.material_id, filename: uploadedName }
            : null,
        },
      };
      room.input_version++;
      room.revision++;
      room.active_task_id = id;
      room.tasks.unshift(task);
      polls.set(id, 0);
      return json(room, 202);
    }
    const task = room.tasks.find((task) => task.id === parts[3]);
    if (!task) return json({ detail: "not_found" }, 404);
    if (parts[4] === "cancel") {
      task.status = "cancelled";
      task.revision++;
      task.message = "已取消";
      return json(room);
    }
    if (parts[4] === "events") {
      if (["queued", "running"].includes(task.status)) {
        const n = (polls.get(task.id) || 0) + 1;
        polls.set(task.id, n);
        task.revision++;
        task.status =
          n < 2
            ? "running"
            : options.incomplete && sequence === 1
              ? "needs_input"
              : "succeeded";
        task.events.push({
          sequence: n,
          kind: n < 2 ? "material" : "search",
          message: n < 2 ? "已读取简历原件" : "已完成联网检索与资料整理",
          at: new Date().toISOString(),
          urls: [],
        });
        task.message =
          task.status === "needs_input"
            ? "原件无法完整读取，请补充文字"
            : task.status === "succeeded"
              ? "本场资料已准备完成"
              : "Codex 正在读取材料";
        if (["succeeded", "needs_input"].includes(task.status)) {
          task.result = {
            ...interviewBundle(task.id),
            material_complete: task.status === "succeeded",
          };
          if (task.status === "succeeded") {
            room.active_bundle_id = task.id;
            room.revision++;
          }
        }
      }
      return json({
        id: task.id,
        status: task.status,
        revision: task.revision,
        events: task.events,
        message: task.message,
      });
    }
    if (parts[4] === "bundle") return json(task.result);
    if (parts[4] === "export")
      return route.fulfill({
        status: 200,
        body:
          url.searchParams.get("format") === "json"
            ? JSON.stringify(task.result)
            : "# 本场面试资料\n\n交易看板项目\n\nhttps://www.w3.org/WAI/test-1",
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition":
            'attachment; filename="interview-materials.md"',
        },
      });
    return json({ detail: "not_found" }, 404);
  });
}
