import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { issueText } from "./issueText";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { download, exportProject } from "../api";
import type { Project } from "../types";
import { exportFile, previewExport } from "./api";
import "../objects/objects.css";

export type ExportFormat = "pptx" | "json" | "fplppt" | "png" | "jpeg" | "pdf";
export default function ExportDialog({
  format,
  current,
  getSnapshot,
  onClose,
}: {
  format: ExportFormat;
  current: number;
  getSnapshot: () => Promise<Project>;
  onClose: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [range, setRange] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]),
    [accepted, setAccepted] = useState("");
  const [signature, setSignature] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const snapshot = await getSnapshot();
      if (format === "pptx") {
        const report = await previewExport(snapshot.id, snapshot.revision);
        const key = JSON.stringify([snapshot.revision, report.issues]);
        setSignature(key);
        setIssues(
          report.issues.map((issue) => issueText(issue, snapshot.document)),
        );
        if (report.issues.length && key !== accepted) return;
        download(
          await exportProject(snapshot.id, snapshot.revision),
          snapshot.title + ".pptx",
        );
      } else if (format === "json" || format === "fplppt") {
        download(
          await exportFile(snapshot.id, snapshot.revision, format),
          snapshot.title + "." + format,
        );
      } else {
        const { exportImages, printDocument } = await import("./staticExport");
        const indices =
          range === "current"
            ? [Math.min(current, snapshot.document.slides.length - 1)]
            : snapshot.document.slides.map((_, i) => i);
        if (format === "pdf") await printDocument(snapshot, indices);
        else await exportImages(snapshot, indices, format);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="presentation-modal-backdrop" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          className="presentation-dialog presentation-dialog-small presentation-dialog-floating presentation-object-dialog"
          onEscapeKeyDown={(e) => {
            keepDialogEscapeLocal(e);
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <header>
            <Dialog.Title>导出 {format.toUpperCase()}</Dialog.Title>
            <button className="btn" disabled={busy} onClick={onClose}>
              关闭
            </button>
          </header>
          <div className="presentation-dialog-body">
            <Dialog.Description>
              {format === "fplppt"
                ? "携带文稿与全部引用素材，可导入其他工作区继续编辑。"
                : format === "json"
                  ? "仅包含文稿结构。素材仍属于当前工作区，跨空间交付请使用文稿包。"
                  : format === "pdf"
                    ? "通过打印保存静态 PDF，视频使用封面，动态效果不参与打印。"
                    : "导出已保存的文稿版本。"}
            </Dialog.Description>
            {["png", "jpeg", "pdf"].includes(format) && (
              <CustomSelect
                ariaLabel="导出页面范围"
                value={range}
                disabled={busy}
                options={[
                  { value: "all", label: "全部幻灯片" },
                  { value: "current", label: "当前幻灯片" },
                ]}
                onChange={setRange}
              />
            )}
            {!!issues.length && (
              <>
                <ul className="presentation-dialog-report">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
                <button
                  className="btn"
                  aria-pressed={accepted === signature}
                  onClick={() =>
                    setAccepted(accepted === signature ? "" : signature)
                  }
                >
                  确认转换差异
                </button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
          <footer>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy
                ? "正在导出…"
                : format === "pdf"
                  ? "打印 / 保存 PDF"
                  : "导出文件"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
