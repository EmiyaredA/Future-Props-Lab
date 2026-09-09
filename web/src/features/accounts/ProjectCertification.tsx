import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { ManagementDialog, ManagementError } from "./ManagementUi";
export function ProjectCertification({
  kind,
  project,
  queryKey,
}: {
  kind: "visual" | "galgame";
  project: {
    id: string;
    title: string;
    revision: number;
    is_official: boolean;
  };
  queryKey: readonly unknown[];
}) {
  const allowed = useWorkspacePermission("projects.certify");
  const writable = useWorkspacePermission("content.write");
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!allowed || !writable) return null;
  return (
    <>
      <button
        aria-label={project.is_official ? "撤销官方标记" : "标记官方作品"}
        title={project.is_official ? "撤销官方标记" : "标记官方作品"}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <BadgeCheck size={17} />
      </button>
      {open && (
        <ManagementDialog
          title={project.is_official ? "撤销官方标记" : "标记官方作品"}
          close={() => setOpen(false)}
          pending={busy}
        >
          <p>
            确认更改「{project.title}
            」的官方认证状态？公开工作区的展台会同步展示此标记。
          </p>
          <ManagementError error={error} />
          <footer>
            <button className="btn" onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .PATCH(
                    "/v1/account/project-certification/{kind}/{project_id}",
                    {
                      params: { path: { kind, project_id: project.id } },
                      body: {
                        is_official: !project.is_official,
                        expected_revision: project.revision,
                      },
                    },
                  )
                  .then(unwrap)
                  .then(() => {
                    setOpen(false);
                    void cache.invalidateQueries({ queryKey });
                  })
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              确认
            </button>
          </footer>
        </ManagementDialog>
      )}
    </>
  );
}
