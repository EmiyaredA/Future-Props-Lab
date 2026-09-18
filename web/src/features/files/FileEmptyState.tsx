import { File, Upload } from "lucide-react";
import type { AssetImportSource } from "@features/files/useAssetBrowserController";

export function FileEmptyState({
  importSource,
  canManage = false,
  noSourceProjects = false,
  filtered,
  busy,
  onUpload,
}: {
  importSource?: AssetImportSource;
  canManage?: boolean;
  noSourceProjects?: boolean;
  filtered: boolean;
  busy: boolean;
  onUpload: () => void;
}) {
  const title = (() => {
    if (importSource === "cross-project") {
      if (noSourceProjects) return "暂无其他可导入的项目";
      if (filtered) return "没有找到可导入的文件";
      return "暂无其他项目可导入的文件";
    }
    if (importSource === "library") {
      if (filtered) {
        return canManage ? "没有找到匹配的文件" : "没有找到可导入的文件";
      }
      return canManage
        ? "文件管理中还没有文件"
        : "文件管理中还没有可导入的文件";
    }
    return "这个文件夹还是空的";
  })();
  return (
    <div className="file-empty">
      <File aria-hidden />
      <strong>{title}</strong>
      {canManage ? (
        <button type="button" disabled={busy} onClick={onUpload}>
          <Upload aria-hidden /> 上传第一个文件
        </button>
      ) : null}
    </div>
  );
}
