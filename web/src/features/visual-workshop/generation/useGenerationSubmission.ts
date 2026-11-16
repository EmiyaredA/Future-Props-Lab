import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createGenerationBatch,
  type ImageGenerationBatchInput,
  type GenerationTaskInput,
} from "../api";
import { submitGenerationTasks } from "./generationSubmission";
import type { GenerationSubmissionCallbacks } from "./generationSubmission";
import { visualWorkshopQueryKeys as visualKeys } from "../queryKeys";
import { apiErrorMessage } from "@platform/api/errors";
import type { GenerationBatch } from "../api";

function errorMessage(error: unknown) {
  return apiErrorMessage(error, "创建任务失败，请稍后重试。");
}

export function useGenerationSubmission({
  projectId,
  canvasNodeId,
  onBeforeSubmit,
  onTaskCreated,
  onBatchCreated,
  layout,
  setNotice,
}: GenerationSubmissionCallbacks & {
  projectId: string;
  onBatchCreated?: (batch: GenerationBatch) => void | Promise<void>;
  layout: "canvas" | "workbench";
  setNotice: (notice: string) => void;
}) {
  const client = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (input: {
      body: GenerationTaskInput;
      count?: number;
      followupBody?: GenerationTaskInput;
    }) =>
      submitGenerationTasks(projectId, input, {
        canvasNodeId,
        onBeforeSubmit,
        onTaskCreated,
      }),
    onSuccess: async (tasks) => {
      const task = tasks.at(-1);
      if (!task) return;
      try {
        await onTaskCreated?.(task);
      } catch (error) {
        setNotice(`任务已提交，但节点关联保存失败：${errorMessage(error)}`);
        return;
      }
      setNotice(
        layout === "workbench"
          ? ""
          : tasks.length === 1
            ? `任务已排队（${task.id.slice(0, 8)}），获得额度后自动执行，可在“生成任务”页查看进度。`
            : `已提交 ${tasks.length} 个生成任务，生成结果将保存为节点输出版本。`,
      );
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
  });
  const createBatchMutation = useMutation<
    Awaited<ReturnType<typeof createGenerationBatch>>,
    unknown,
    ImageGenerationBatchInput
  >({
    mutationFn: createGenerationBatch.bind(null, projectId),
    onSuccess: async (batch) => {
      void client.invalidateQueries({ queryKey: visualKeys.generationBatches });
      try {
        await onBatchCreated?.(batch);
      } catch (error) {
        setNotice(`宫格任务已提交，但画布保存失败：${errorMessage(error)}`);
        return;
      }
      setNotice(
        layout === "workbench"
          ? ""
          : `已提交 ${batch.grid_size} 张图片，${
              batch.grid_output === "nodes"
                ? "将自动排列到画布"
                : "完成后自动拼成大图"
            }。`,
      );
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      void client.invalidateQueries({ queryKey: visualKeys.generationTasks });
    },
  });
  return { createMutation, createBatchMutation };
}
