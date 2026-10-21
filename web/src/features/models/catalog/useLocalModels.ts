import { useEffect, useRef, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  attachLocalModel,
  getLocalModels,
  localModelAction,
  type LocalModel,
} from "@features/models/localModelApi";
import { modelQueryKeys } from "@features/models/queryKeys";
import { ApiError } from "@platform/api/client";
import { apiErrorMessage } from "@platform/api/errors";

type LocalModels = Awaited<ReturnType<typeof getLocalModels>>;
export type LocalModelAction =
  Parameters<typeof localModelAction>[1] | "attach";
const actionMessages: Record<LocalModelAction, string> = {
  install: "已开始安装，完成后会自动启用服务。",
  cancel: "已取消安装，可主动重试。",
  enable: "已启用本机服务，首次调用时加载模型。",
  stop: "已停止本机服务，各空间暂时无法调用此模型。",
  uninstall: "已清理本机模型文件，历史音频仍保留。",
  attach: "已添加到当前空间；现有默认模型保持原设置。",
};

export function useLocalModels(revision: number) {
  const client = useQueryClient();
  const pending =
    useIsMutating({ mutationKey: modelQueryKeys.localModelActions }) > 0;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const query = useQuery({
    queryKey: modelQueryKeys.localModels,
    queryFn: getLocalModels,
    refetchInterval: 2000,
  });
  const signature = query.data?.items
    .map(
      (model) =>
        `${model.id}:${model.status}:${model.enabled}:${model.compatible}`,
    )
    .join("|");
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (signature !== undefined && signature !== previous.current) {
      void client.invalidateQueries({ queryKey: modelQueryKeys.catalog });
      void client.invalidateQueries({
        queryKey: modelQueryKeys.inferenceOptions,
      });
    }
    previous.current = signature;
  }, [client, signature]);

  const mutation = useMutation({
    mutationKey: modelQueryKeys.localModelActions,
    retry: false,
    mutationFn: async ({
      model,
      action,
    }: {
      model: LocalModel;
      action: LocalModelAction;
    }) => {
      // Auth changes clear the cache. An old response must not repopulate it.
      const ownerQuery = client
        .getQueryCache()
        .find({ queryKey: modelQueryKeys.localModels, exact: true });
      const isCurrentScope = () =>
        ownerQuery !== undefined &&
        client
          .getQueryCache()
          .find({ queryKey: modelQueryKeys.localModels, exact: true }) ===
          ownerQuery;
      setMessage("");
      setError("");
      setRefreshWarning("");
      let succeeded = false;
      try {
        await client.cancelQueries({ queryKey: modelQueryKeys.localModels });
        if (action === "attach") {
          const catalog = await attachLocalModel(model.id, revision);
          if (!isCurrentScope()) return false;
          client.setQueryData(modelQueryKeys.catalog, catalog);
        } else {
          const result = await localModelAction(model, action);
          if (!isCurrentScope()) return false;
          client.setQueryData<LocalModels>(
            modelQueryKeys.localModels,
            (current) =>
              current
                ? {
                    ...current,
                    items: current.items.map((item) =>
                      item.id === result.id ? result : item,
                    ),
                  }
                : current,
          );
        }
        succeeded = true;
        setMessage(actionMessages[action]);
      } catch (cause) {
        setError(
          cause instanceof ApiError &&
            cause.problem.code === "revision_conflict"
            ? "状态已被其他操作更新，正在刷新。请核对最新状态后重新操作。"
            : apiErrorMessage(cause, "操作失败，请稍后重试"),
        );
      } finally {
        const refreshed = await Promise.allSettled(
          isCurrentScope()
            ? [
                query.refetch({ throwOnError: true }),
                client.invalidateQueries(
                  { queryKey: modelQueryKeys.catalog },
                  { throwOnError: true },
                ),
                client.invalidateQueries(
                  { queryKey: modelQueryKeys.inferenceOptions },
                  { throwOnError: true },
                ),
              ]
            : [],
        );
        if (refreshed.some((result) => result.status === "rejected"))
          setRefreshWarning(
            "部分状态刷新失败，请刷新核对；不要重复提交已成功的操作。",
          );
      }
      return succeeded;
    },
  });
  async function act(model: LocalModel, action: LocalModelAction) {
    if (client.isMutating({ mutationKey: modelQueryKeys.localModelActions }))
      return false;
    return mutation.mutateAsync({ model, action });
  }
  return { query, act, pending, message, error, refreshWarning };
}
