import { createGenerationTask, type GenerationTaskInput } from "../api";
import { apiErrorMessage } from "@platform/api/errors";
import type { GenerationDrawerProps } from "./generationDrawerTypes";

export async function submitGenerationTasks(
  projectId: string,
  input: {
    body: GenerationTaskInput;
    count?: number;
    followupBody?: GenerationTaskInput;
  },
  callbacks: Pick<
    GenerationDrawerProps,
    "canvasNodeId" | "onBeforeSubmit" | "onTaskCreated"
  >,
) {
  const { body, count = 1, followupBody } = input;
  const { canvasNodeId, onBeforeSubmit, onTaskCreated } = callbacks;
  const tasks = [];
  for (let index = 0; index < count; index++) {
    let next = index === 0 ? body : (followupBody ?? body);
    if (index > 0 && canvasNodeId && onBeforeSubmit) {
      const revision = await onBeforeSubmit();
      next = {
        ...next,
        canvas_node_id: canvasNodeId,
        expected_canvas_revision:
          typeof revision === "number" ? revision : undefined,
      };
    }
    try {
      tasks.push(await createGenerationTask(projectId, next));
      if (index < count - 1) await onTaskCreated?.(tasks.at(-1)!);
    } catch (error) {
      if (tasks.length)
        throw new Error(
          `已接受 ${tasks.length} 个任务；后续提交未完成：${apiErrorMessage(error, "创建任务失败")}`,
        );
      throw error;
    }
  }
  return tasks;
}
