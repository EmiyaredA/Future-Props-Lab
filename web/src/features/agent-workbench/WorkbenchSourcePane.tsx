import { useQuery } from "@tanstack/react-query";
import { getTurnSource } from "./executionApi";
import { workbenchKeys } from "./queryKeys";
import { FileReader } from "./FileReader";
export type SourceTarget = { turnId: string; callId: string };
export function WorkbenchSourcePane({
  owner,
  chatId,
  target,
  close,
}: {
  owner: string;
  chatId: string;
  target: SourceTarget;
  close: () => void;
}) {
  const source = useQuery({
    queryKey: workbenchKeys.source(owner, chatId, target.turnId, target.callId),
    queryFn: ({ signal }) =>
      getTurnSource(chatId, target.turnId, target.callId, signal),
    retry: false,
    gcTime: 0,
  });
  return (
    <FileReader
      data={source.isError ? undefined : source.data}
      pending={source.isPending}
      error={source.error?.message}
      close={close}
    />
  );
}
