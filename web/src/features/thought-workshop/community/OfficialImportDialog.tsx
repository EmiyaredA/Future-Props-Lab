import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAccountId,
  useWorkspaceId,
} from "@platform/auth/WorkspacePermissions";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import type { components } from "@generated/api";
import { unwrap } from "@platform/api/client";
import { thoughtKeys } from "../queryKeys";
import { importOfficialNotes, getOfficialImportReceipt } from "./api";
export function OfficialImportDialog({
  preview,
  close,
  imported,
}: {
  preview: components["schemas"]["SeedPreview"];
  close: () => void;
  imported: (id: string) => void;
}) {
  const key = `fpl-official-import/${useAccountId()}/${useWorkspaceId()}`;
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [request, setRequest] = useState<
    components["schemas"]["SeedImportInput"]
  >(() => {
    try {
      const prior = localStorage.getItem(key);
      if (prior) return JSON.parse(prior);
    } catch {
      /* invalid pending metadata */
    }
    return {
      request_id: crypto.randomUUID(),
      package_version: preview.package_version,
    };
  });
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // Save before sending so refresh/reconnect can query the committed receipt.
      localStorage.setItem(key, JSON.stringify(request));
      const status = await getOfficialImportReceipt(request.request_id);
      let result;
      if (status.response.ok) result = await unwrap(status);
      else if (status.response.status === 404) {
        if (request.package_version !== preview.package_version) {
          const fresh = {
            request_id: crypto.randomUUID(),
            package_version: preview.package_version,
          };
          setRequest(fresh);
          localStorage.setItem(key, JSON.stringify(fresh));
          throw new Error(
            "旧请求未完成且导入包已更新。请确认新版本后再次导入。",
          );
        }
        result = await importOfficialNotes(request);
      } else await unwrap(status);
      if (!result) return;
      localStorage.removeItem(key);
      await client.invalidateQueries({ queryKey: thoughtKeys.all });
      close();
      if (result.knowledge_base_ids?.[0])
        imported(result.knowledge_base_ids[0]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "导入结果暂时未知；重试会先查询回执。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open
      title="导入现有官方文档"
      confirmLabel="导入到当前 Workspace"
      pending={busy}
      onCancel={close}
      onConfirm={() => void submit()}
      description={
        <div className="community-dialog-body">
          <p>
            将创建 {preview.library_count} 个私人知识库，含{" "}
            {preview.article_count} 篇文章及 {preview.figure_count}{" "}
            幅图形。正文、目录及内部链接将转换为普通笔记。
          </p>
          <p>
            导入后可在我的知识库编辑。内容不会自动发布；请检查后通过普通发布设置勾选官方标记并配置权限。
          </p>
          <ul>
            {preview.titles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
        </div>
      }
    />
  );
}
