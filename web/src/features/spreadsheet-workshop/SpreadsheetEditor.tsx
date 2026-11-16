import { lazy, Suspense, useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Download, Save, Copy, RefreshCw } from "lucide-react";
import type { WorkbookInstance } from "@fortune-sheet/react";
import {
  useNavigationProtection,
  type Guard,
} from "@shared/ui/navigationGuards";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { LoadingState } from "@shared/ui/LoadingState";
import { ApiError } from "@platform/api/client";
import { publicImageSources } from "@shared/lib/imageSources";
import { booksApi, download, type Document, type Project } from "./api";
import { SaveQueue } from "./saveQueue";
import { snapshot, stable } from "./codec";

const Grid = lazy(() =>
  import("./FortuneEditor").then((m) => ({ default: m.FortuneEditor })),
);

export function SpreadsheetEditor({
  initial,
  readOnly,
  onBack,
  onOpen,
  onReload,
  registerNavigationGuard,
}: {
  initial: Project;
  readOnly: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onReload: () => void;
  registerNavigationGuard?: (guard: Guard | null) => void;
}) {
  const [queue] = useState(
    () => new SaveQueue(initial, (body) => booksApi.save(initial.id, body)),
  );
  const [, render] = useReducer((n) => n + 1, 0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState("xlsx");
  const [exit, setExit] = useState<(() => void) | null>(null);
  const [reload, setReload] = useState(false);
  const [copyRequest] = useState(() => crypto.randomUUID());
  const instance = useRef<WorkbookInstance | null>(null);
  const protection = useNavigationProtection();
  const conflict =
    queue.error instanceof ApiError && queue.error.status === 409;
  const error = queue.error instanceof Error ? queue.error.message : notice;

  useEffect(() => {
    const unsubscribe = queue.subscribe(render);
    return () => {
      unsubscribe();
      queue.dispose();
    };
  }, [queue]);
  useEffect(() => {
    if (
      !queue.dirty ||
      queue.saving ||
      queue.error ||
      readOnly ||
      !queue.draft.title.trim()
    )
      return;
    const timer = setTimeout(() => {
      void queue.flush().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [queue, queue.dirty, queue.saving, queue.error, queue.draft, readOnly]);
  useEffect(() => {
    const guard: Guard = (resume) => {
      if (!queue.dirty && !queue.saving) return false;
      setExit(() => resume);
      return true;
    };
    if (registerNavigationGuard) {
      registerNavigationGuard(guard);
      return () => registerNavigationGuard(null);
    }
    return protection?.register(guard);
  }, [queue, protection, registerNavigationGuard]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ((queue.dirty || queue.saving) && !protection?.allowsUnload()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [queue, protection]);

  function changed(document: Document) {
    queue.update(queue.draft.title, document);
  }
  function initialized(api: WorkbookInstance) {
    instance.current = api;
    const document = snapshot(api.getAllSheets());
    if (
      !readOnly &&
      (initial.calculation === "pending" ||
        stable(document) !== stable(initial.document))
    )
      changed(document);
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function exportFile() {
    const project = readOnly ? initial : await queue.flush();
    const sheet = instance.current?.getAllSheets().find((s) => s.status === 1);
    const blob = await booksApi.export(initial.id, {
      expected_revision: project.revision,
      format: format === "xlsx" ? "xlsx" : "csv",
      sheet_id: sheet?.id,
      value_mode: format === "csv-formulas" ? "formulas" : "values",
    });
    download(blob, queue.draft.title + (format === "xlsx" ? ".xlsx" : ".csv"));
  }
  return (
    <section className="spreadsheet-editor" aria-label="工作簿编辑器">
      <header className="spreadsheet-editor-header">
        <button
          type="button"
          className="spreadsheet-icon-button"
          onClick={onBack}
          aria-label="返回我的工作簿"
        >
          <ArrowLeft size={20} />
        </button>
        <img
          {...publicImageSources("/brand/spreadsheet-workshop-mark.png", 42)}
          width={42}
          height={42}
          alt=""
        />
        <input
          aria-label="工作簿名称"
          value={queue.draft.title}
          maxLength={120}
          readOnly={readOnly}
          onChange={(e) => queue.update(e.target.value, queue.draft.document)}
        />
        <span className="spreadsheet-save-status" role="status">
          {readOnly
            ? "只读"
            : queue.saving
              ? "正在保存…"
              : queue.error
                ? "保存失败"
                : queue.dirty
                  ? "待保存"
                  : "已保存"}
        </span>
        <div className="spreadsheet-editor-actions">
          {!readOnly && (
            <button
              type="button"
              disabled={
                busy || conflict || queue.saving || !queue.draft.title.trim()
              }
              onClick={() => void run(() => queue.flush())}
            >
              <Save size={16} />
              {queue.error ? "重试保存" : "保存"}
            </button>
          )}
          <CustomSelect
            ariaLabel="导出格式"
            value={format}
            onChange={setFormat}
            options={[
              { value: "xlsx", label: "Excel (.xlsx)" },
              { value: "csv", label: "当前表 CSV" },
              { value: "csv-formulas", label: "CSV（公式文本）" },
            ]}
          />
          <button
            type="button"
            disabled={busy || conflict}
            onClick={() => void run(exportFile)}
          >
            <Download size={16} />
            导出
          </button>
          {initial.source_name && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  download(
                    await booksApi.original(initial.id),
                    initial.source_name!,
                  ),
                )
              }
            >
              原件
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="spreadsheet-notice" role="alert">
          {error}
          {conflict && (
            <>
              <button type="button" onClick={() => setReload(true)}>
                <RefreshCw size={15} />
                重新加载
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const copy = await booksApi.create(
                      queue.draft.title + "（副本）",
                      queue.draft.document,
                      copyRequest,
                    );
                    // Copy has retained the draft; navigating to it must not resubmit the conflicted write.
                    queue.acceptNavigation();
                    onOpen(copy.id);
                  })
                }
              >
                <Copy size={15} />
                另存副本
              </button>
            </>
          )}
        </div>
      )}
      <Suspense
        fallback={<LoadingState label="正在加载表格编辑器…" variant="region" />}
      >
        <Grid
          document={initial.document}
          readOnly={readOnly || conflict}
          onChange={changed}
          onReady={initialized}
        />
      </Suspense>
      <footer className="spreadsheet-editor-footer">
        {queue.project.document.sheets.length} 张工作表 · 版本{" "}
        {queue.project.revision}
        <span>公式由浏览器计算；Excel 导出文件打开后重算</span>
      </footer>
      <ConfirmDialog
        open={!!exit}
        title="保存工作簿后离开？"
        description={
          conflict
            ? "存在版本冲突，请先重新加载或另存副本。"
            : "当前编辑尚未保存到服务。"
        }
        confirmLabel="保存后离开"
        cancelLabel="继续编辑"
        tone="primary"
        pending={busy}
        confirmDisabled={conflict}
        onCancel={() => setExit(null)}
        onConfirm={() =>
          run(async () => {
            await queue.flush();
            const resume = exit;
            setExit(null);
            resume?.();
          })
        }
      />
      <ConfirmDialog
        open={reload}
        title="重新加载工作簿？"
        description="这会放弃当前未保存的编辑，读取服务端最新版本。"
        confirmLabel="放弃编辑并加载"
        onCancel={() => setReload(false)}
        onConfirm={onReload}
      />
    </section>
  );
}
