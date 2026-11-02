import { FileManagementPage } from "@features/files/FileManagementPage";
import { ReadOnlyFiles } from "@features/files/ReadOnlyFiles";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { useRuntimeAccess } from "@features/accounts/useRuntimeAccess";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { IndependentShell } from "./IndependentShell";
import "./assets.css";

function Files() {
  const localBrowser = useRuntimeAccess();
  const editable = useAccountPermission("content.write");
  return (
    <IndependentShell title="文件管理">
      <div className="file-service-scroll">
        {editable ? (
          <FileManagementPage canOpenLocalFolder={localBrowser} />
        ) : (
          <ReadOnlyFiles />
        )}
      </div>
    </IndependentShell>
  );
}

export default function AssetsApplication() {
  return (
    <RuntimeAccessProvider>
      <Files />
    </RuntimeAccessProvider>
  );
}
