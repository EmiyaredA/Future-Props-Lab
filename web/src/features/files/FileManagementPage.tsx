import { LoadingScene } from "@shared/ui/LoadingScene";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FolderSync } from "lucide-react";
import { AssetBrowser } from "@features/files/AssetBrowser";
import {
  getStorageLayoutStatus,
  migrateStorageLayout,
  openLibraryFolder,
  type StorageLayoutMigration,
} from "@features/files/api";
import { fileQueryKeys } from "@features/files/queryKeys";
import "@features/files/files.css";

function bytesLabel(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function FileManagementPage({
  initialKind,
  canOpenLocalFolder = false,
}: {
  initialKind?: string;
  canOpenLocalFolder?: boolean;
}) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<StorageLayoutMigration>();
  const layout = useQuery({
    queryKey: fileQueryKeys.storageLayout,
    queryFn: getStorageLayoutStatus,
  });
  const migrate = useMutation({
    mutationFn: async () => {
      let latest: StorageLayoutMigration | undefined;
      for (;;) {
        latest = await migrateStorageLayout(50);
        setProgress(latest);
        if (
          latest.complete ||
          latest.issues.length > 0 ||
          (latest.migrated_assets === 0 && latest.migrated_projects === 0)
        )
          return latest;
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: fileQueryKeys.storageLayout });
      await client.invalidateQueries({ queryKey: fileQueryKeys.allFiles });
    },
  });
  const openFolder = useMutation({
    mutationFn: openLibraryFolder,
  });
  const status = layout.data;
  const issues = progress?.issues ?? [];
  return (
    <section className="file-management-page">
      {status && !status.complete ? (
        <section className="file-storage-migration" aria-live="polite">
          <span className="file-storage-migration-icon">
            {migrate.isPending ? (
              <LoadingScene />
            ) : issues.length ? (
              <AlertTriangle aria-hidden />
            ) : (
              <FolderSync aria-hidden />
            )}
          </span>
          <div>
            <strong>整理项目素材目录</strong>
            <p>
              {migrate.isPending
                ? `正在迁移，剩余 ${progress?.remaining_assets ?? status.pending_assets} 个素材…`
                : `检测到 ${status.pending_projects} 个项目目录和 ${status.pending_assets} 个旧版素材（${bytesLabel(status.pending_bytes)}）。`}
            </p>
            {issues.length ? (
              <small>
                有 {issues.length} 个素材需要处理：{issues[0].message}
              </small>
            ) : null}
          </div>
          <button
            type="button"
            disabled={migrate.isPending}
            onClick={() => {
              setProgress(undefined);
              migrate.mutate();
            }}
          >
            {migrate.isPending
              ? "正在迁移"
              : progress
                ? "继续迁移"
                : "开始迁移"}
          </button>
        </section>
      ) : status?.complete && progress ? (
        <div className="file-storage-migration-complete" role="status">
          <CheckCircle2 aria-hidden />
          项目素材目录整理完成
        </div>
      ) : null}
      {openFolder.isError && (
        <p className="file-notice" role="alert">
          无法打开本地文件夹，请重试。
        </p>
      )}
      <AssetBrowser
        initialKind={initialKind}
        onOpenLocalFolder={
          canOpenLocalFolder ? () => openFolder.mutate() : undefined
        }
        openingLocalFolder={openFolder.isPending}
      />
    </section>
  );
}
