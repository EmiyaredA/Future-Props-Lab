import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { LoadingState } from "@shared/ui/LoadingState";
import { getTurnSource } from "./executionApi";
import { workbenchKeys } from "./queryKeys";

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
  const [diff, setDiff] = useState(false);
  const container = useRef<HTMLElement>(null);
  const selected = useRef<HTMLDivElement>(null);
  const source = useQuery({
    queryKey: workbenchKeys.source(owner, chatId, target.turnId, target.callId),
    queryFn: ({ signal }) =>
      getTurnSource(chatId, target.turnId, target.callId, signal),
    retry: false,
    gcTime: 0,
  });
  const data = source.isError ? undefined : source.data;
  const content = data && (diff ? data.diff : data.text);
  useEffect(() => {
    container.current?.focus();
  }, []);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [data, diff]);
  return (
    <aside
      className="aw-source-pane"
      aria-label="源码预览"
      ref={container}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <header className="aw-source-header">
        <FileCode2 size={16} aria-hidden="true" />
        <strong title={data?.path}>{data?.path ?? "源码预览"}</strong>
        {data?.diff && (
          <button
            className="btn"
            type="button"
            aria-pressed={diff}
            onClick={() => setDiff(!diff)}
          >
            {diff ? "当前文件" : "显示更改"}
          </button>
        )}
        <button
          className="btn aw-source-close"
          type="button"
          aria-label="关闭源码"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      {source.isPending && (
        <LoadingState variant="inline" label="正在读取源码…" />
      )}
      {source.isError && (
        <p className="aw-error" role="alert">
          {source.error.message}
        </p>
      )}
      {content != null && (
        <div
          className="aw-source-code"
          tabIndex={0}
          aria-label={diff ? "审批差异" : "当前文件内容"}
        >
          {content.split("\n").map((text, index) => {
            const line = index + 1;
            const marked = !diff && line === data?.line;
            const style = diff && !/^(\+\+\+|---)/.test(text) ? text[0] : "";
            return (
              <div
                key={index}
                ref={marked ? selected : undefined}
                className={`aw-source-line${marked ? " is-target" : style === "+" ? " is-added" : style === "-" ? " is-removed" : ""}`}
              >
                {!diff && <span aria-hidden="true">{line}</span>}
                <code>{text || " "}</code>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
