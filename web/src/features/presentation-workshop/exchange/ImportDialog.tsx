import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { issueText } from "./issueText";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import type { components } from "@generated/api";
import { SlidePreview } from "../SlideSurface";
import { presentationKeys } from "../queryKeys";
import { previewImport, importProject } from "./api";
import "../objects/objects.css";

type Preview = components["schemas"]["ImportPreview"];
export default function ImportDialog({
  file,
  onClose,
  onOpen,
}: {
  file: File;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const returnFocus = useDialogReturnFocus();
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    void runTransfer((onProgress) =>
      previewImport(file, controller.signal, { onProgress }),
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "预览失败");
      });
    return () => controller.abort();
  }, [file, runTransfer]);
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
          className="presentation-dialog presentation-dialog-large presentation-dialog-floating presentation-object-dialog"
          onEscapeKeyDown={(e) => {
            keepDialogEscapeLocal(e);
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <TransferFeedback progress={activeTransferProgress} />

          <header>
            <Dialog.Title>导入演示文稿</Dialog.Title>
            <button className="btn" onClick={onClose} disabled={busy}>
              关闭
            </button>
          </header>
          <Dialog.Description>
            先检查内容与转换差异，确认后创建新文稿。
          </Dialog.Description>
          <div className="presentation-dialog-body">
            {error && <p role="alert">{error}</p>}
            {!preview && !error && <p role="status">正在解析 {file.name}…</p>}
            {preview && (
              <>
                <div className="presentation-dialog-split">
                  <div>
                    <h3>{preview.title}</h3>
                    <SlidePreview
                      slide={preview.document.slides[page]}
                      size={preview.document}
                      assetUrls={preview.preview_assets}
                    />
                    <div className="presentation-object-actions">
                      <button
                        className="btn"
                        disabled={!page || busy}
                        onClick={() => setPage(page - 1)}
                      >
                        上一页
                      </button>
                      <span>
                        {page + 1} / {preview.document.slides.length}
                      </span>
                      <button
                        className="btn"
                        disabled={
                          page === preview.document.slides.length - 1 || busy
                        }
                        onClick={() => setPage(page + 1)}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                  <div>
                    {!(preview.issues ?? []).length && (
                      <p>
                        没有发现需要确认的转换差异，可创建新文稿后继续编辑。
                      </p>
                    )}
                    {!!(preview.issues ?? []).length && (
                      <>
                        <ul className="presentation-dialog-report">
                          {(preview.issues ?? []).map((issue, i) => (
                            <li key={i}>
                              {issueText(issue, preview.document)}
                            </li>
                          ))}
                        </ul>
                        <button
                          className="btn"
                          aria-pressed={accepted}
                          disabled={busy}
                          onClick={() => setAccepted(!accepted)}
                        >
                          {accepted ? "已确认转换差异" : "确认以上转换差异"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          {preview && (
            <footer>
              <button className="btn" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={
                  busy || (!!(preview.issues ?? []).length && !accepted)
                }
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void runTransfer((onProgress) =>
                    importProject(file, accepted, { onProgress }),
                  )
                    .then(async (project) => {
                      cache.setQueryData(
                        presentationKeys.project(project.id),
                        project,
                      );
                      await cache.invalidateQueries({
                        queryKey: presentationKeys.all,
                      });
                      onOpen(project.id);
                    })
                    .catch((e) => {
                      setError(e instanceof Error ? e.message : "导入失败");
                      setBusy(false);
                    });
                }}
              >
                {busy ? "正在创建新文稿…" : "创建新文稿"}
              </button>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
