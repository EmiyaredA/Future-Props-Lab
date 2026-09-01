import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { ApiDownload } from "@platform/api/client";
import { downloadProjectSnapshot } from "./downloadProjectSnapshot";
import type { ProjectEditorState } from "./ProjectEditorDialog";
import {
  prependProject,
  removeProject,
  upsertProject,
  type ProjectCollection,
} from "./projectCollection";

type ProjectRecord = { id: string; title: string };
type ImportResult<T> = { project: T; warnings?: { message: string }[] };
export type ProjectPatch<T> = { project: T; changes: Partial<T> };

export type ProjectLibraryAdapter<T extends ProjectRecord> = {
  queryKey: QueryKey;
  listProjects: () => Promise<ProjectCollection<T>>;
  createProject: () => Promise<T>;
  patchProject: (input: ProjectPatch<T>) => Promise<T>;
  deleteProject: (project: T) => Promise<unknown>;
  importSnapshot: (file: File) => Promise<ImportResult<T>>;
  exportSnapshot: (project: T) => Promise<ApiDownload>;
  openFolder: (project: T) => Promise<unknown>;
  onOpenProject: (projectId: string) => void;
  errorMessage: (error: unknown) => string;
};

export function useProjectLibraryController<T extends ProjectRecord>(
  adapter: ProjectLibraryAdapter<T>,
) {
  const client = useQueryClient();
  const [editor, setEditor] = useState<ProjectEditorState<T> | null>(null);
  const [notice, setNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: adapter.queryKey,
    queryFn: adapter.listProjects,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: adapter.queryKey });
  const createMutation = useMutation({
    mutationFn: adapter.createProject,
    onSuccess: (project) => {
      client.setQueryData<ProjectCollection<T>>(adapter.queryKey, (current) =>
        prependProject(current, project),
      );
      adapter.onOpenProject(project.id);
    },
    onError: (error) => setNotice(adapter.errorMessage(error)),
  });
  const patchMutation = useMutation({
    mutationFn: adapter.patchProject,
    onSuccess: (project) => {
      client.setQueryData<ProjectCollection<T>>(adapter.queryKey, (current) =>
        upsertProject(current, project),
      );
      setEditor(null);
    },
    onError: (error) => {
      setNotice(adapter.errorMessage(error));
      refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: adapter.deleteProject,
    onSuccess: (_data, project) => {
      client.setQueryData<ProjectCollection<T>>(adapter.queryKey, (current) =>
        removeProject(current, project.id),
      );
      setEditor(null);
    },
    onError: (error) => {
      setNotice(adapter.errorMessage(error));
      refresh();
    },
  });
  const importMutation = useMutation({
    mutationFn: adapter.importSnapshot,
    onSuccess: ({ project, warnings }) => {
      client.setQueryData<ProjectCollection<T>>(adapter.queryKey, (current) =>
        prependProject(current, project),
      );
      if (warnings?.length)
        setNotice(warnings.map((item) => item.message).join(" "));
      adapter.onOpenProject(project.id);
    },
    onError: (error) => setNotice(adapter.errorMessage(error)),
  });
  const exportMutation = useMutation({
    mutationFn: adapter.exportSnapshot,
    onSuccess: (download) => downloadProjectSnapshot(download),
    onError: (error) => setNotice(adapter.errorMessage(error)),
  });
  const openFolderMutation = useMutation({
    mutationFn: adapter.openFolder,
    onError: (error) => setNotice(adapter.errorMessage(error)),
  });

  return {
    projectsQuery,
    editor,
    setEditor,
    notice,
    setNotice,
    refresh,
    createMutation,
    patchMutation,
    deleteMutation,
    importMutation,
    exportMutation,
    openFolderMutation,
    pending:
      createMutation.isPending ||
      patchMutation.isPending ||
      deleteMutation.isPending,
  };
}
