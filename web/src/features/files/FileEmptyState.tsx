import { File, Upload } from "lucide-react";
export function FileEmptyState({
  importing,
  filtered,
  busy,
  onUpload,
}: {
  importing: boolean;
  filtered: boolean;
  busy: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="file-empty">
      <File aria-hidden />
      <strong>
        {importing
          ? filtered
            ? "没有找到可导入的文件"
            : "文件管理中还没有可导入的文件"
          : "这个文件夹还是空的"}
      </strong>
      {!importing && (
        <button type="button" disabled={busy} onClick={onUpload}>
          <Upload aria-hidden /> 上传第一个文件
        </button>
      )}
    </div>
  );
}
