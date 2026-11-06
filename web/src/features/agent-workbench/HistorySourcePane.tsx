import { useQuery } from "@tanstack/react-query";
import { FileReader } from "./FileReader";
import { getHistorySource } from "./api";
import { workbenchKeys } from "./queryKeys";
import type { FileReference } from "./fileReferences";

export type FileAccess = { allowed: boolean; unlock: () => void };

export function HistorySourcePane({
  owner,
  sessionId,
  target,
  close,
  access,
}: {
  owner: string;
  sessionId: string;
  target: FileReference;
  close: () => void;
  access?: FileAccess;
}) {
  const allowed = access?.allowed !== false;
  const source = useQuery({
    queryKey: workbenchKeys.historySource(
      owner,
      sessionId,
      target.path,
      target.line,
    ),
    queryFn: ({ signal }) => getHistorySource(sessionId, target, signal),
    retry: false,
    gcTime: 0,
    enabled: allowed,
  });
  return (
    <FileReader
      data={!allowed || source.isError ? undefined : source.data}
      pending={allowed && source.isPending}
      error={
        !allowed
          ? "验证并解锁后，即可阅读当前项目文件。"
          : source.error?.message
      }
      action={
        !allowed ? (
          <button type="button" className="btn" onClick={access?.unlock}>
            验证并阅读
          </button>
        ) : source.isError ? (
          <button
            type="button"
            className="btn"
            onClick={() => void source.refetch()}
          >
            重新读取
          </button>
        ) : undefined
      }
      close={close}
    />
  );
}
