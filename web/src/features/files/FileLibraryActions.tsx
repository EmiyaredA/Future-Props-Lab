import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Download,
  FolderInput,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Upload,
} from "lucide-react";

export function FileLibraryActions({
  busy,
  onExport,
  onImportZip,
  onImportFolder,
  onOpenLocalFolder,
  openingLocalFolder,
}: {
  busy: boolean;
  onExport: () => void;
  onImportZip: () => void;
  onImportFolder: () => void;
  onOpenLocalFolder?: () => void;
  openingLocalFolder?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" aria-label="更多文件操作">
          <MoreHorizontal aria-hidden />
          <span>更多操作</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="file-library-menu"
          align="end"
          sideOffset={6}
          collisionPadding={12}
        >
          <Menu.Item disabled={busy} onSelect={onExport}>
            {busy ? (
              <LoaderCircle className="spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            导出当前目录
          </Menu.Item>
          <Menu.Item disabled={busy} onSelect={onImportZip}>
            <Upload aria-hidden />
            导入 ZIP
          </Menu.Item>
          <Menu.Item disabled={busy} onSelect={onImportFolder}>
            <FolderInput aria-hidden />
            导入文件夹
          </Menu.Item>
          {onOpenLocalFolder && (
            <>
              <Menu.Separator />
              <Menu.Item
                disabled={openingLocalFolder}
                onSelect={onOpenLocalFolder}
              >
                <FolderOpen aria-hidden />
                {openingLocalFolder ? "正在打开…" : "打开本地文件夹"}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
