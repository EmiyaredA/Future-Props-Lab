import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { issueText } from "./issueText";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { download, exportProject } from "../api";
import type { Project } from "../types";
import { exportFile, previewExport } from "./api";
import "../objects/objects.css";
import "./export.css";
import type {} from "@platform/desktop";

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
  const [stage, setStage] = useState("");
  const [readyFile, setReadyFile] = useState<{
    blob: Blob;
    filename: string;
  } | null>(null);
  const [result, setResult] = useState<{
    message: string;
    complete: boolean;
    receipt?: { id: string; path: string };
  } | null>(null);
  const running = useRef(false);
  const saveFile = useCallback(
    async (file: { blob: Blob; filename: string }) => {
      const desktop = window.futurePropsDesktop;
      if (desktop?.saveExportFile) {
        setStage("请选择保存位置，确认后写入文件…");
        const receipt = await desktop.saveExportFile(
          file.filename,
          new Uint8Array(await file.blob.arrayBuffer()),
        );
        setResult({
          message: receipt ? "导出文件已保存" : "已取消保存，文件尚未保存。",
          complete: !!receipt,
          receipt: receipt ?? undefined,
        });
      } else {
        download(file.blob, file.filename);
        setResult({
          message: `已发起下载：${file.filename}。请在${desktop ? "桌面保存窗口" : "浏览器下载列表"}中查看；保存位置由下载设置或保存窗口决定。`,
          complete: true,
        });
      }
    },
    [],
  );
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setStage("正在保存最新文稿…");
    try {
      if (readyFile) {
        await saveFile(readyFile);
        return;
      }
      const snapshot = await getSnapshot();
      const filename =
        snapshot.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").slice(0, 60) ||
        "演示文稿";
      let blob: Blob;
      if (format === "pptx") {
        setStage("正在检查 PPTX 转换差异…");
        const report = await previewExport(snapshot.id, snapshot.revision);
        const key = JSON.stringify([snapshot.revision, report.issues]);
        setSignature(key);
        setIssues(
          report.issues.map((issue) => issueText(issue, snapshot.document)),
        );
        if (report.issues.length && key !== accepted) return;
        setStage(`正在生成 PPTX（共 ${snapshot.document.slides.length} 页）…`);
        blob = await exportProject(snapshot.id, snapshot.revision);
      } else if (format === "json" || format === "fplppt") {
        setStage("正在打包文稿与素材…");
        blob = await exportFile(snapshot.id, snapshot.revision, format);
      } else {
        setStage("正在渲染页面，等待字体与素材…");
        const { exportImages, printDocument } = await import("./staticExport");
        const indices =
          range === "current"
            ? [Math.min(current, snapshot.document.slides.length - 1)]
            : snapshot.document.slides.map((_, i) => i);
        if (format === "pdf") await printDocument(snapshot, indices);
        else await exportImages(snapshot, indices, format);
        setResult({
          complete: true,
          message:
            format === "pdf"
              ? "已打开打印窗口，请在打印窗口中选择保存 PDF 的位置。"
              : "已发起图片下载，请在下载列表或保存窗口中查看保存位置。",
        });
        return;
      }
      const file = { blob, filename: `${filename}.${format}` };
      setReadyFile(file);
      await saveFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [accepted, current, format, getSnapshot, range, readyFile, saveFile]);
  const started = useRef(false);
  useEffect(() => {
    if (format === "pptx" && !started.current) {
      started.current = true;
      void run();
    }
  }, [format, run]);
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
                  ? "仅包含文稿结构。素材仍属于当前账号，跨空间交付请使用文稿包。"
                  : format === "pdf"
                    ? "通过打印保存静态 PDF，视频使用封面，动态效果不参与打印。"
                    : "导出已保存的文稿版本。"}
            </Dialog.Description>
            {["pptx", "json", "fplppt"].includes(format) && (
              <p className="muted">
                {window.futurePropsDesktop?.saveExportFile
                  ? "文件生成后弹出“另存为”，可选择保存目录和文件名。"
                  : "文件生成后交给下载窗口；请在下载列表或保存窗口中查看位置。"}
              </p>
            )}
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
            {!!issues.length && !readyFile && (
              <>
                <ul className="presentation-dialog-report">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
                <button
                  className="btn"
                  disabled={busy}
                  aria-pressed={accepted === signature}
                  onClick={() =>
                    setAccepted(accepted === signature ? "" : signature)
                  }
                >
                  确认转换差异
                </button>
              </>
            )}
            {busy && (
              <div className="presentation-export-progress" role="status">
                <p>{stage}</p>
                <div
                  role="progressbar"
                  aria-label="文件导出进度"
                  aria-valuetext={stage}
                >
                  <span />
                </div>
              </div>
            )}
            {result && (
              <div className="presentation-export-result" role="status">
                <p>{result.message}</p>
                {result.receipt && (
                  <>
                    <p className="presentation-export-path">
                      {result.receipt.path}
                    </p>
                    {window.futurePropsDesktop?.revealExportFile && (
                      <button
                        className="btn"
                        onClick={() => {
                          setError("");
                          void window.futurePropsDesktop!.revealExportFile!(
                            result.receipt!.id,
                          ).catch((e: unknown) =>
                            setError(
                              e instanceof Error ? e.message : "无法打开文件夹",
                            ),
                          );
                        }}
                      >
                        在文件夹中显示
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
          <footer>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => (result?.complete ? onClose() : void run())}
            >
              {busy
                ? "正在导出…"
                : result?.complete
                  ? "完成"
                  : readyFile
                    ? window.futurePropsDesktop?.saveExportFile
                      ? "选择保存位置"
                      : "再次下载"
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
