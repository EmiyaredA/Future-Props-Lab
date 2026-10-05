import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiErrorMessage } from "@platform/api/errors";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { renameVideoEditorAsset } from "./api";
import { videoEditorQueryKeys } from "./queryKeys";
import type { VideoEditorAsset } from "./types";

export function VideoEditorAssetRenameDialog({
  projectId,
  asset,
  disabled,
  onClose,
}: {
  projectId: string;
  asset: VideoEditorAsset;
  disabled?: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  // Freeze the opened version so a background refresh cannot silently overwrite a conflict.
  const [original] = useState(asset);
  const rename = useMutation({
    mutationFn: (name: string) =>
      renameVideoEditorAsset(
        projectId,
        original.id,
        original.revision ?? 0,
        name,
      ),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.assets(projectId),
      });
      onClose();
    },
    onError: () => {
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.assets(projectId),
      });
    },
  });
  const conflict =
    rename.error instanceof ApiError && rename.error.status === 409;
  return (
    <TextInputDialog
      open
      title="重命名素材"
      label="素材名称"
      initialValue={original.displayName}
      maxLength={255}
      confirmLabel="保存名称"
      pending={rename.isPending}
      confirmDisabled={disabled || conflict}
      error={
        rename.error
          ? conflict
            ? "素材已被修改，请取消并重新打开重命名。"
            : apiErrorMessage(rename.error, "重命名失败，请重试")
          : undefined
      }
      onCancel={onClose}
      onConfirm={(name) => {
        if (disabled || rename.isPending || conflict) return;
        if (name === original.displayName) onClose();
        else rename.mutate(name);
      }}
    />
  );
}
