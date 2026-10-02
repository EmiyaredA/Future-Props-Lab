import { useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { exportDiagram } from "./export";
import "./diagrams.css";
export function DiagramViewer({
  title,
  children,
  svg,
  onCopy,
  onEdit,
}: {
  title: string;
  children: ReactNode;
  svg: () => Promise<string>;
  onCopy?: () => void;
  onEdit?: () => void;
}) {
  const [zoom, setZoom] = useState(1),
    [full, setFull] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const save = async (format: "svg" | "png") => {
    setBusy(true);
    setError("");
    try {
      await exportDiagram(await svg(), title, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <>
      <div className="diagram-toolbar" aria-label="图表操作">
        <strong>{title}</strong>
        <button
          type="button"
          className="btn small"
          aria-label="缩小图表"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="btn small"
          aria-label="放大图表"
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
        >
          ＋
        </button>
        <button type="button" className="btn small" onClick={() => setZoom(1)}>
          适应窗口
        </button>
        <button
          type="button"
          className="btn small"
          ref={!full ? trigger : undefined}
          onClick={() => setFull(!full)}
        >
          {full ? "退出放大" : "放大阅读"}
        </button>
        {onEdit && (
          <button type="button" className="btn small" onClick={onEdit}>
            编辑画板
          </button>
        )}
        {onCopy && (
          <button type="button" className="btn small" onClick={onCopy}>
            复制到个人笔记
          </button>
        )}
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => void save("svg")}
        >
          导出 SVG
        </button>
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => void save("png")}
        >
          导出 PNG
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="diagram-viewport" tabIndex={0} aria-label="图表预览">
        <div className="diagram-paper" style={{ width: `${zoom * 100}%` }}>
          {children}
        </div>
      </div>
    </>
  );
  return (
    <section className="diagram-viewer" aria-label={title}>
      {!full && body}
      <Dialog.Root open={full} onOpenChange={setFull}>
        <Dialog.Portal>
          <Dialog.Overlay className="diagram-overlay" />
          <Dialog.Content
            className="diagram-fullscreen"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          >
            <Dialog.Title className="diagram-sr-only">{title}</Dialog.Title>
            {full && body}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
