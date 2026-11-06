import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileCode2, X } from "lucide-react";
import { LoadingState } from "@shared/ui/LoadingState";
import type { SourcePreview } from "./executionApi";
import { fileLanguage, highlightLines } from "./codeHighlight";

export function FileReader({
  data,
  pending,
  error,
  close,
  action,
}: {
  data?: SourcePreview;
  pending: boolean;
  error?: string;
  close: () => void;
  action?: ReactNode;
}) {
  const [diff, setDiff] = useState(false);
  const container = useRef<HTMLElement>(null);
  const selected = useRef<HTMLDivElement>(null);
  const content = data && (diff ? data.diff : data.text);
  const language = diff ? "diff" : fileLanguage(data?.path ?? "");
  const highlighted = useMemo(
    () => highlightLines(content ?? "", language),
    [content, language],
  );
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
        <strong title={data?.path}>{data?.path ?? "文件阅读"}</strong>
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
      {pending && <LoadingState variant="inline" label="正在读取源码…" />}
      {!!error && (
        <p className="aw-error" role="alert">
          {error}
        </p>
      )}
      {action && <div className="aw-source-actions">{action}</div>}
      {data && (
        <p className="aw-source-caption">
          只读 · {diff ? "审批更改记录" : "当前磁盘文件"}
          {!diff && data.line ? ` · 第 ${data.line} 行` : ""}
        </p>
      )}
      {content != null && (
        <div
          className="aw-source-code"
          data-language={language}
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
                <code>
                  {text
                    ? highlighted[index].map((token, tokenIndex) =>
                        token.className ? (
                          <span key={tokenIndex} className={token.className}>
                            {token.text}
                          </span>
                        ) : (
                          token.text
                        ),
                      )
                    : " "}
                </code>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
