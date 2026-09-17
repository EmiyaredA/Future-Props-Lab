import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApiBlob } from "@platform/api/client";
import type { SelectOption } from "@shared/ui/CustomSelect";
import {
  createFolder,
  deleteFolder,
  deleteManagedFile,
  exportLibraryFolderArchive,
  getFiles,
  getFolders,
  importLibraryFolderArchive,
  importLibraryFolderEntries,
  patchFolder,
  patchManagedFile,
  uploadManagedFile,
  type LibraryFolderImportResult,
  type ManagedFile,
  type MediaKind,
} from "@features/files/api";
import {
  type AssetViewMode,
  type FileEditor,
  type UploadItem,
  VIEW_KEY,
  fileDownloadName,
  folderOptionLabel,
  isFolderWithin,
  pathToFolder,
  stripOriginalExtension,
} from "@features/files/AssetBrowserParts";
import { fileQueryKeys, invalidateFileScope } from "@features/files/queryKeys";

export function useAssetBrowserController({
  projectId,
  compact,
  importMode,
  viewMode,
  onViewModeChange,
}: {
  projectId?: string;
  compact: boolean;
  importMode: boolean;
  viewMode?: AssetViewMode;
  onViewModeChange?: (view: AssetViewMode) => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const compactActions = useRef<HTMLDivElement>(null);
  const dialogTitleId = useId();
  const [folderId, setFolderId] = useState<string>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | MediaKind>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [localView, setLocalView] = useState<AssetViewMode>(() =>
    window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid",
  );
  const view = viewMode ?? localView;
  const [compactFilterOpen, setCompactFilterOpen] = useState(false);
  const [compactAddOpen, setCompactAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [openMenu, setOpenMenu] = useState<string>();
  const [previewFile, setPreviewFile] = useState<ManagedFile>();
  const [editor, setEditor] = useState<FileEditor>(null);
  const [editorError, setEditorError] = useState("");
  const sourceProjectId = importMode ? undefined : projectId;
  const libraryMode = !projectId && !importMode;
  const foldersQuery = useQuery({
    queryKey: fileQueryKeys.folders(sourceProjectId),
    queryFn: () => getFolders(sourceProjectId),
  });
  const filesQuery = useQuery({
    queryKey: fileQueryKeys.list({
      projectId: sourceProjectId,
      folderId,
      query,
      mediaKind: kind === "all" ? undefined : kind,
      sort,
      includeReferences: !importMode,
    }),
    queryFn: () =>
      getFiles({
        projectId: sourceProjectId,
        folderId,
        query,
        mediaKind: kind === "all" ? undefined : kind,
        sort,
        includeReferences: !importMode,
      }),
  });
  const refresh = () => {
    void invalidateFileScope(client, sourceProjectId, { folders: true });
  };
  const act = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => {
      setEditor(null);
      setEditorError("");
      setOpenMenu(undefined);
      refresh();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "操作失败";
      setEditorError(message);
      setNotice(message);
    },
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let succeeded = 0;
      let failed = 0;
      for (const [index, file] of files.entries()) {
        setUploads((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: "uploading" } : item,
          ),
        );
        try {
          await uploadManagedFile(file, sourceProjectId, folderId);
          succeeded += 1;
          setUploads((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: "success", error: undefined }
                : item,
            ),
          );
        } catch (error) {
          failed += 1;
          setUploads((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    status: "error",
                    error: error instanceof Error ? error.message : "上传失败",
                  }
                : item,
            ),
          );
        }
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (failed === 0) {
        setNotice(`已成功上传 ${succeeded} 个文件`);
        setUploads([]);
      } else if (succeeded === 0) {
        setNotice("文件上传失败，请查看下方原因");
        setUploads((current) =>
          current.filter((item) => item.status === "error"),
        );
      } else {
        setNotice(`已上传 ${succeeded} 个文件，${failed} 个失败`);
        setUploads((current) =>
          current.filter((item) => item.status === "error"),
        );
      }
    },
    onSettled: () => refresh(),
  });
  const folders = useMemo(
    () => foldersQuery.data?.items ?? [],
    [foldersQuery.data?.items],
  );
  const files = useMemo(
    () => filesQuery.data?.items ?? [],
    [filesQuery.data?.items],
  );
  const childFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return folders
      .filter((folder) =>
        folderId ? folder.parent_id === folderId : folder.parent_id === null,
      )
      .filter(
        (folder) =>
          !normalizedQuery ||
          folder.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
      )
      .sort((left, right) =>
        sort === "name"
          ? left.name.localeCompare(right.name, "zh-CN")
          : Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );
  }, [folderId, folders, query, sort]);
  const path = pathToFolder(folderId, folders);
  const completedUploads = uploads.filter(
    (item) => item.status === "success" || item.status === "error",
  ).length;
  const moveTargetOptions = useMemo<SelectOption[]>(() => {
    if (!editor || !editor.kind.startsWith("move-")) return [];
    const available =
      editor.kind === "move-folder"
        ? folders.filter(
            (folder) => !isFolderWithin(folder, editor.folder.id, folders),
          )
        : folders;
    return [
      { value: "root", label: "根目录" },
      ...available.map((folder) => ({
        value: folder.id,
        label: folderOptionLabel(folder, folders),
      })),
    ];
  }, [editor, folders]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    if (!compactFilterOpen && !compactAddOpen) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!compactActions.current?.contains(event.target as Node)) {
        setCompactFilterOpen(false);
        setCompactAddOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCompactFilterOpen(false);
        setCompactAddOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [compactAddOpen, compactFilterOpen]);

  const setView = (next: AssetViewMode) => {
    setLocalView(next);
    onViewModeChange?.(next);
  };
  const openEditor = (next: Exclude<FileEditor, null>) => {
    setOpenMenu(undefined);
    setEditorError("");
    setEditor(next);
  };
  const closeEditor = () => {
    if (act.isPending) return;
    setEditor(null);
    setEditorError("");
  };
  const updateEditorName = (name: string) => {
    setEditor((current) => {
      if (
        !current ||
        !["create-folder", "rename-folder", "rename-file"].includes(
          current.kind,
        )
      )
        return current;
      return { ...current, name };
    });
  };
  const updateEditorTarget = (target: string) => {
    setEditor((current) => {
      if (
        !current ||
        (current.kind !== "move-folder" && current.kind !== "move-file")
      )
        return current;
      return { ...current, target };
    });
  };
  const submitEditor = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editor || act.isPending) return;
    if (editor.kind === "create-folder") {
      const name = editor.name.trim();
      if (name) act.mutate(() => createFolder(name, sourceProjectId, folderId));
    } else if (editor.kind === "rename-folder") {
      const name = editor.name.trim();
      if (name && name !== editor.folder.name)
        act.mutate(() => patchFolder(editor.folder, { name }));
    } else if (editor.kind === "rename-file") {
      const name = stripOriginalExtension(editor.name, editor.file);
      if (
        name &&
        name !== stripOriginalExtension(editor.file.display_name, editor.file)
      )
        act.mutate(() => patchManagedFile(editor.file, { display_name: name }));
    } else if (editor.kind === "move-folder") {
      act.mutate(() =>
        patchFolder(
          editor.folder,
          editor.target === "root"
            ? { move_to_root: true }
            : { parent_id: editor.target },
        ),
      );
    } else if (editor.kind === "move-file") {
      act.mutate(() =>
        patchManagedFile(
          editor.file,
          editor.target === "root"
            ? { move_to_root: true }
            : { folder_id: editor.target },
        ),
      );
    } else if (editor.kind === "delete-folder") {
      act.mutate(() => deleteFolder(editor.folder));
    } else if (editor.kind === "delete-file") {
      act.mutate(() => deleteManagedFile(editor.file));
    }
  };
  const uploadFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length || upload.isPending) return;
    const selected = Array.from(selectedFiles);
    setNotice("");
    setUploads(
      selected.map((file, index) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        name: file.name,
        status: "queued",
      })),
    );
    upload.mutate(selected);
  };
  const downloadFile = async (file: ManagedFile) => {
    try {
      const blob = await fetchApiBlob(`/v1/files/${file.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileDownloadName(file);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败");
    }
  };
  const summarizeImport = (result: LibraryFolderImportResult) => {
    const skipped = result.skipped.length;
    const base = `已导入 ${result.created_folders} 个文件夹、${result.created_files} 个文件`;
    return skipped ? `${base}，跳过 ${skipped} 项` : base;
  };
  const archiveTransfer = useMutation({
    mutationFn: async (
      operation: () => Promise<LibraryFolderImportResult | void>,
    ) => operation(),
    onSuccess: () => {
      refresh();
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : "导入导出失败");
    },
  });
  const exportFolderArchive = (targetFolderId?: string) => {
    if (!libraryMode || archiveTransfer.isPending) return;
    setNotice("");
    setOpenMenu(undefined);
    archiveTransfer.mutate(async () => {
      const downloaded = await exportLibraryFolderArchive(targetFolderId);
      const url = URL.createObjectURL(downloaded.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloaded.filename || "library-folder.zip";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("已导出文件夹归档");
    });
  };
  const importZipArchive = (selected: FileList | null) => {
    const archive = selected?.[0];
    if (!archive || !libraryMode || archiveTransfer.isPending) return;
    setNotice("");
    archiveTransfer.mutate(async () => {
      const result = await importLibraryFolderArchive(archive, folderId);
      setNotice(summarizeImport(result));
      return result;
    });
  };
  const importFolderEntries = (selected: FileList | null) => {
    if (!selected?.length || !libraryMode || archiveTransfer.isPending) return;
    const entries = Array.from(selected)
      .map((file) => {
        const relativePath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        return { file, relativePath };
      })
      .filter((entry) => entry.relativePath.trim());
    if (!entries.length) return;
    setNotice("");
    archiveTransfer.mutate(async () => {
      const result = await importLibraryFolderEntries(entries, folderId);
      setNotice(summarizeImport(result));
      return result;
    });
  };
  const hasItems = childFolders.length > 0 || files.length > 0;
  const showContent = hasItems || (!compact && !importMode);
  const noMatches = !hasItems && Boolean(query.trim() || kind !== "all");

  const editorTitle = editor
    ? {
        "create-folder": "新建文件夹",
        "rename-folder": "重命名文件夹",
        "rename-file": "重命名文件",
        "move-folder": "移动文件夹",
        "move-file": "移动文件",
        "delete-folder": "删除文件夹",
        "delete-file":
          editor.kind === "delete-file" && editor.file.is_reference
            ? "移除文件引用"
            : "删除文件",
      }[editor.kind]
    : "";
  const editorSubmitLabel = editor
    ? {
        "create-folder": "创建文件夹",
        "rename-folder": "保存名称",
        "rename-file": "保存名称",
        "move-folder": "确认移动",
        "move-file": "确认移动",
        "delete-folder": "确认删除",
        "delete-file":
          editor.kind === "delete-file" && editor.file.is_reference
            ? "移除引用"
            : "确认删除",
      }[editor.kind]
    : "";
  const editorSubmitDisabled = (() => {
    if (!editor) return true;
    if (editor.kind === "create-folder") return !editor.name.trim();
    if (editor.kind === "rename-folder")
      return !editor.name.trim() || editor.name.trim() === editor.folder.name;
    if (editor.kind === "rename-file")
      return (
        !stripOriginalExtension(editor.name, editor.file) ||
        stripOriginalExtension(editor.name, editor.file) ===
          stripOriginalExtension(editor.file.display_name, editor.file)
      );
    if (editor.kind === "move-folder")
      return editor.target === (editor.folder.parent_id ?? "root");
    if (editor.kind === "move-file")
      return editor.target === (editor.file.folder_id ?? "root");
    return false;
  })();
  return {
    client,
    fileInput,
    zipInput,
    folderInput,
    compactActions,
    dialogTitleId,
    folderId,
    setFolderId,
    query,
    setQuery,
    kind,
    setKind,
    sort,
    setSort,
    view,
    compactFilterOpen,
    setCompactFilterOpen,
    compactAddOpen,
    setCompactAddOpen,
    notice,
    setNotice,
    uploads,
    setUploads,
    openMenu,
    setOpenMenu,
    previewFile,
    setPreviewFile,
    editor,
    editorError,
    foldersQuery,
    filesQuery,
    act,
    upload,
    archiveTransfer,
    libraryMode,
    files,
    childFolders,
    path,
    completedUploads,
    moveTargetOptions,
    setView,
    openEditor,
    closeEditor,
    updateEditorName,
    updateEditorTarget,
    submitEditor,
    uploadFiles,
    downloadFile,
    exportFolderArchive,
    importZipArchive,
    importFolderEntries,
    showContent,
    noMatches,
    editorTitle,
    editorSubmitLabel,
    editorSubmitDisabled,
  };
}
