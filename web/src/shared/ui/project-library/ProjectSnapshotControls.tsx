import { useRef, type ChangeEvent } from "react";
import { Download, FolderOpen, LoaderCircle, Upload } from "lucide-react";

export function ProjectSnapshotImportButton({
  pending,
  onImport,
}: {
  pending: boolean;
  onImport: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const selected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };
  return (
    <>
      <button
        type="button"
        className="workshop-secondary"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {pending ? (
          <LoaderCircle className="spinning" aria-hidden />
        ) : (
          <Upload aria-hidden />
        )}
        {pending ? "正在导入…" : "导入快照"}
      </button>
      <input
        ref={input}
        className="project-snapshot-file-input"
        type="file"
        accept=".zip,application/zip"
        aria-label="选择项目快照压缩包"
        onChange={selected}
      />
    </>
  );
}

export function ProjectSnapshotCardActions({
  title,
  exporting,
  opening,
  onExport,
  onOpenFolder,
}: {
  title: string;
  exporting: boolean;
  opening: boolean;
  onExport: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={`导出“${title}”项目快照`}
        title="导出项目快照"
        disabled={exporting}
        onClick={onExport}
      >
        {exporting ? (
          <LoaderCircle className="spinning" aria-hidden />
        ) : (
          <Download aria-hidden />
        )}
      </button>
      <button
        type="button"
        aria-label={`打开“${title}”项目文件夹`}
        title="打开项目文件夹"
        disabled={opening}
        onClick={onOpenFolder}
      >
        {opening ? (
          <LoaderCircle className="spinning" aria-hidden />
        ) : (
          <FolderOpen aria-hidden />
        )}
      </button>
    </>
  );
}
