import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import {
  fileQueryKeys,
  getFiles,
  getFolders,
  pathToFolder,
  type ManagedFile,
} from "@features/files";
import {
  SearchablePickerDialog,
  SearchablePickerField,
  type PickerItem,
} from "@shared/ui/SearchablePickerDialog";
import { getVisualCanvas } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { modelMime, projectModelPath } from "../previs/projectModels";

export type PickedCardAsset = { id: string; label: string; projectId?: string };

export function CardAssetPicker({
  kind,
  project,
  projects,
  value,
  onChoose,
  onClose,
}: {
  kind: "image" | "model";
  project?: string;
  projects: PickerItem[];
  value?: string | null;
  onChoose: (item: PickedCardAsset | null) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(project ?? "");
  const projectId = source || undefined;
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(projectId),
    queryFn: () => getFolders(projectId),
  });
  const listedFolders = folders.data?.items;
  const includeReferences = kind === "image" && !!projectId;
  const mediaKind = kind === "image" ? "image" : "document";
  const files = useQueries({
    queries: [
      undefined,
      ...(listedFolders?.map((folder) => folder.id) ?? []),
    ].map((folderId) => {
      const options = {
        projectId,
        folderId,
        mediaKind,
        includeReferences,
      } as const;
      return {
        queryKey: fileQueryKeys.list(options),
        queryFn: () => getFiles(options),
      };
    }),
    combine: (queries) => ({
      assets: queries.flatMap((query) => query.data?.items ?? []),
      pending: queries.some((query) => query.isPending),
      error: queries.find((query) => query.isError)?.error,
    }),
  });
  const canvas = useQuery({
    queryKey: visualWorkshopQueryKeys.canvas(projectId ?? ""),
    queryFn: () => getVisualCanvas(projectId!),
    enabled: kind === "image" && !!projectId,
  });
  const assets = useMemo(() => {
    const entries = new Map<string, PickerItem & { projectId?: string }>();
    const folders = listedFolders ?? [];
    const sourceName =
      projects.find((entry) => entry.id === projectId)?.label ?? "总文件";
    const add = (file: ManagedFile) => {
      if (kind === "model" && file.mime_type !== modelMime) return;
      const id = kind === "model" ? projectModelPath(file.id) : file.id;
      if (entries.has(id)) return;
      entries.set(id, {
        id,
        label: file.display_name,
        keywords: file.original_filename,
        detail: [
          sourceName,
          ...pathToFolder(file.folder_id ?? undefined, folders).map(
            (folder) => folder.name,
          ),
        ].join(" / "),
        icon: kind,
        preview: kind === "image" ? `/v1/files/${file.id}/content` : undefined,
        projectId:
          file.source === "project"
            ? (file.project_id ?? undefined)
            : undefined,
      });
    };
    files.assets.forEach(add);
    for (const node of canvas.data?.nodes ?? []) {
      if (
        kind === "image" &&
        node.kind === "image" &&
        node.asset_id &&
        !entries.has(node.asset_id)
      ) {
        entries.set(node.asset_id, {
          id: node.asset_id,
          label: node.title || "画布图片",
          detail: `${sourceName} / 画布`,
          icon: "image",
          preview: `/v1/files/${node.asset_id}/content`,
        });
      }
    }
    return entries;
  }, [kind, projects, projectId, listedFolders, files.assets, canvas.data]);
  const error =
    folders.error ?? files.error ?? (canvas.isError ? canvas.error : null);

  return (
    <SearchablePickerDialog
      key={source}
      title={kind === "image" ? "选择采用图" : "关联 3D 模型"}
      searchLabel={kind === "image" ? "搜索图片" : "搜索 3D 模型"}
      value={value}
      items={[...assets.values()]}
      loading={folders.isPending || files.pending || canvas.isLoading}
      error={
        error
          ? apiErrorMessage(error, "部分素材读取失败，请关闭后重试。")
          : undefined
      }
      clearLabel={kind === "image" ? "移除采用图" : "解除关联"}
      toolbar={
        projects.length > 0 && (
          <SearchablePickerField
            title="选择素材来源"
            searchLabel="搜索项目"
            items={[{ id: "", label: "总文件", icon: "folder" }, ...projects]}
            value={source}
            onChange={setSource}
          />
        )
      }
      onClose={onClose}
      onChoose={(item) => {
        if (!item) onChoose(null);
        else {
          const result = assets.get(item.id);
          if (!result) throw new Error("素材已不可用，请重新选择。");
          onChoose({
            id: result.id,
            label: result.label,
            projectId: result.projectId,
          });
        }
      }}
    />
  );
}
