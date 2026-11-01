import { useState } from "react";
import { useAccountId } from "@platform/auth/AccountAccess";
import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { thoughtKeys } from "../queryKeys";
import {
  getArticlePermissions,
  setArticlePermissions,
  type ArticleSetting,
} from "./api";
import { ArticlePermissionsForm } from "./ArticlePermissionsForm";
export function PermissionsDialog({
  publication,
  notes,
  close,
  saved,
}: {
  publication: string;
  notes: string[];
  close: () => void;
  saved: () => void;
}) {
  const user = useAccountId() ?? "";
  const query = useQuery({
    queryKey: thoughtKeys.communityPermissions(user, publication, notes),
    queryFn: () => getArticlePermissions(publication, notes),
    retry: false,
  });
  const [draft, setDraft] = useState<ArticleSetting | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const first = query.data?.[0];
  const value =
    draft ??
    (first
      ? {
          note_id: first.note_id,
          expected_revision: first.revision,
          visibility: first.visibility,
          active: first.active,
          members: first.members.map((m) => ({
            username: m.username,
            role: m.role,
          })),
        }
      : null);
  const save = async () => {
    if (!value || !query.data) return;
    setBusy(true);
    setError("");
    try {
      await setArticlePermissions(
        publication,
        query.data.map((a) => ({
          ...value,
          note_id: a.note_id,
          expected_revision: a.revision,
        })),
      );
      saved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open
      tone="primary"
      confirmDisabled={!value || !query.isSuccess}
      title={
        notes.length > 1
          ? `批量设置 ${notes.length} 篇文章权限`
          : `${first?.title ?? "文章"} · 访问权限`
      }
      confirmLabel="保存权限"
      pending={busy}
      onCancel={close}
      onConfirm={() => void save()}
      description={
        <div className="community-dialog-body">
          {query.isPending && <p role="status">加载权限…</p>}
          {query.isError && <p role="alert">{query.error.message}</p>}
          {notes.length > 1 && query.data && (
            <p className="community-meta">
              {query.data.map((a) => a.title).join("、")}
            </p>
          )}
          {value && (
            <>
              <ArticlePermissionsForm value={value} onChange={setDraft} />
              <label className="community-publish-toggle">
                <input
                  type="checkbox"
                  checked={value.active ?? true}
                  onChange={(e) =>
                    setDraft({ ...value, active: e.target.checked })
                  }
                />
                在社区中发布
              </label>
              <p className="community-meta">
                权限仅作用于所选文章，不授予源账号的访问权。取消发布会立即关闭社区访问。
              </p>
            </>
          )}
          {error && (
            <div className="thought-error" role="alert">
              {error}
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void query.refetch().then((result) => {
                    if (result.isSuccess) {
                      setDraft(null);
                      setError("");
                    }
                  })
                }
              >
                重新载入权限
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}
