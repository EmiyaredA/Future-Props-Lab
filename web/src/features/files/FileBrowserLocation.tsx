import type { ManagedFolder } from "./api";

export function FileBrowserLocation({
  rootLabel,
  heading,
  path,
  folderCount,
  fileCount,
  loading,
  onOpenFolder,
}: {
  rootLabel: string;
  heading: boolean;
  path: ManagedFolder[];
  folderCount: number;
  fileCount: number;
  loading: boolean;
  onOpenFolder: (id?: string) => void;
}) {
  return (
    <div className="file-location">
      <div className="file-breadcrumb" aria-label="文件路径">
        <button type="button" onClick={() => onOpenFolder()}>
          {heading ? (
            <span role="heading" aria-level={1}>
              {rootLabel}
            </span>
          ) : (
            rootLabel
          )}
        </button>
        {path.map((folder) => (
          <span key={folder.id}>
            <i aria-hidden>/</i>
            <button type="button" onClick={() => onOpenFolder(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </div>
      {!loading && (
        <small>
          {folderCount} 个文件夹 · {fileCount} 个文件
        </small>
      )}
    </div>
  );
}
