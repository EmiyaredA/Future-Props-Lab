import { ProjectCoverPreview } from "@shared/ui/project-library/ProjectCoverPreview";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  Plus,
  Upload,
  Search,
  Copy,
  Trash2,
} from "lucide-react";
import { LoadingState } from "@shared/ui/LoadingState";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Guard } from "@shared/ui/navigationGuards";
import { booksApi, spreadsheetKeys, type Preview, type Summary } from "./api";
import { SpreadsheetEditor } from "./SpreadsheetEditor";
import "./spreadsheet.css";

type Props = {
  owner: string;
  projectId?: string;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  utilities?: ReactNode;
  registerNavigationGuard?: (guard: Guard | null) => void;
};

export function SpreadsheetPage(props: Props) {
  return props.projectId ? (
    <ProjectLoader key={props.owner + props.projectId} {...props} />
  ) : (
    <Library key={props.owner} {...props} />
  );
}

function ProjectLoader(props: Props) {
  const [generation, reload] = useState(0);
  const project = useQuery({
    queryKey: [
      ...spreadsheetKeys.project(props.owner, props.projectId!),
      generation,
    ],
    queryFn: ({ signal }) => booksApi.get(props.projectId!, signal),
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    gcTime: 0,
  });
  if (project.isPending || project.isFetching)
    return <LoadingState label="正在读取工作簿…" variant="region" />;
  if (project.error)
    return (
      <section className="spreadsheet-library">
        <p role="alert">{project.error.message}</p>
        <button type="button" onClick={props.onBack}>
          返回工作簿列表
        </button>
        <button type="button" onClick={() => void project.refetch()}>
          重试
        </button>
      </section>
    );
  return (
    <SpreadsheetEditor
      key={generation}
      initial={project.data}
      readOnly={props.readOnly}
      registerNavigationGuard={props.registerNavigationGuard}
      onBack={props.onBack}
      onOpen={props.onOpen}
      onReload={() => reload((n) => n + 1)}
    />
  );
}

function Library({ owner, readOnly, onOpen, utilities }: Props) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [removing, setRemoving] = useState<Summary | null>(null);
  const [encoding, setEncoding] = useState("utf-8-sig");
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef(crypto.randomUUID());
  const deleteRequest = useRef(crypto.randomUUID());
  const confirmRequest = useRef(crypto.randomUUID());
  const pendingUpload = useRef<AbortController | null>(null);
  const active = useRef(true);
  const open = (id: string) => {
    if (active.current) onOpen(id);
  };
  const list = useQuery({
    queryKey: spreadsheetKeys.list(owner, query, offset),
    queryFn: ({ signal }) => booksApi.list(query, offset, signal),
    refetchOnMount: "always",
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pendingUpload.current?.abort();
    };
  }, []);

  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="spreadsheet-library">
      <header className="spreadsheet-library-header">
        <div>
          <p className="spreadsheet-eyebrow">SPREADSHEET WORKSHOP</p>
          <h1>我的工作簿</h1>
          <p>把数据、公式和想法，整理在一张表里。</p>
        </div>
        {utilities}
      </header>
      <div className="spreadsheet-library-tools">
        <label className="spreadsheet-search">
          <Search size={18} />
          <input
            value={query}
            placeholder="搜索工作簿…"
            aria-label="搜索工作簿"
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        {!readOnly && (
          <>
            <CustomSelect
              ariaLabel="CSV 导入编码"
              value={encoding}
              onChange={setEncoding}
              options={[
                { value: "utf-8-sig", label: "UTF-8" },
                { value: "gb18030", label: "GB18030" },
              ]}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => upload.current?.click()}
            >
              <Upload size={17} />
              导入文件
            </button>
            <button
              type="button"
              className="spreadsheet-primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const project = await booksApi.create(
                    "未命名工作簿",
                    undefined,
                    request.current,
                  );
                  request.current = crypto.randomUUID();
                  open(project.id);
                })
              }
            >
              <Plus size={18} />
              新建工作簿
            </button>
            <input
              ref={upload}
              hidden
              type="file"
              accept=".xlsx,.csv"
              aria-label="选择 Excel 或 CSV 文件"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                pendingUpload.current?.abort();
                const controller = new AbortController();
                pendingUpload.current = controller;
                void action(async () => {
                  const result = await booksApi.preview(
                    file,
                    encoding as "utf-8-sig" | "gb18030",
                    controller.signal,
                  );
                  if (!controller.signal.aborted) {
                    confirmRequest.current = crypto.randomUUID();
                    setPreview(result);
                  }
                });
              }}
            />
          </>
        )}
      </div>
      {(error || list.error) && (
        <p role="alert" className="spreadsheet-notice">
          {error || list.error?.message}
          {list.error && (
            <button type="button" onClick={() => void list.refetch()}>
              重试读取
            </button>
          )}
        </p>
      )}
      {list.isPending ? (
        <LoadingState label="正在读取工作簿列表…" variant="region" />
      ) : (
        <div className="spreadsheet-cards">
          {list.data?.items.map((project) => (
            <article className="spreadsheet-card" key={project.id}>
              <button
                type="button"
                className="spreadsheet-card-open"
                onClick={() => onOpen(project.id)}
              >
                <span className="spreadsheet-card-art">
                  {project.preview ? (
                    <ProjectCoverPreview
                      namespace="spreadsheet"
                      projectId={project.id}
                      title={project.title}
                      preview={project.preview}
                    />
                  ) : (
                    <span className="project-cover-placeholder">
                      暂无内容预览
                    </span>
                  )}
                </span>
                <h2>{project.title}</h2>
                <p>
                  更新于{" "}
                  {new Date(
                    project.updated_at +
                      (project.updated_at.endsWith("Z") ||
                      /[+-]\d\d:\d\d$/.test(project.updated_at)
                        ? ""
                        : "Z"),
                  ).toLocaleString("zh-CN")}
                </p>
              </button>
              {!readOnly && (
                <div className="spreadsheet-card-actions">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`复制 ${project.title}`}
                    onClick={() =>
                      void action(async () => {
                        const source = await booksApi.get(project.id);
                        const copy = await booksApi.create(
                          project.title + "（副本）",
                          source.document,
                          request.current,
                        );
                        request.current = crypto.randomUUID();
                        open(copy.id);
                      })
                    }
                  >
                    <Copy size={16} />
                    复制
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`删除 ${project.title}`}
                    onClick={() => {
                      deleteRequest.current = crypto.randomUUID();
                      setRemoving(project);
                    }}
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              )}
            </article>
          ))}
          {!list.error && !list.data?.total && (
            <div className="spreadsheet-empty">
              <FileSpreadsheet size={54} />
              <h2>从第一张表开始</h2>
              <p>
                {readOnly
                  ? "当前账号还没有工作簿。"
                  : "新建空白工作簿，或导入 Excel、CSV 文件。"}
              </p>
            </div>
          )}
        </div>
      )}
      {!!list.data?.total && (
        <nav className="spreadsheet-pagination" aria-label="工作簿分页">
          <button
            type="button"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >
            上一页
          </button>
          <span>
            共 {list.data.total} 份 · 第 {Math.floor(offset / 30) + 1} 页
          </span>
          <button
            type="button"
            disabled={offset + 30 >= list.data.total}
            onClick={() => setOffset(offset + 30)}
          >
            下一页
          </button>
        </nav>
      )}
      <p className="spreadsheet-library-help">
        支持 XLSX / CSV，单文件最多 20
        MiB。导入前会列出兼容差异，原件随工作簿保留。
      </p>
      <ConfirmDialog
        open={!!preview}
        title="确认导入工作簿"
        tone="primary"
        confirmLabel="创建可编辑副本"
        cancelLabel="取消导入"
        pending={busy}
        description={
          <div className="spreadsheet-import-preview">
            <p>{preview?.filename}</p>
            <p>工作表：{preview?.sheets.join("、")}</p>
            {preview?.warnings.length ? (
              <>
                <strong>以下内容无法完整保留：</strong>
                <ul>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>已完成检查，未发现已知的结构兼容差异。</p>
            )}
            <p>导入原件将保留，可在工作簿中下载。</p>
            {error && <p role="alert">{error}</p>}
          </div>
        }
        onCancel={() => setPreview(null)}
        onConfirm={() =>
          action(async () => {
            const project = await booksApi.confirm(
              preview!.id,
              preview!,
              confirmRequest.current,
            );
            setPreview(null);
            open(project.id);
          })
        }
      />
      <ConfirmDialog
        open={!!removing}
        title="删除工作簿？"
        description={`将删除“${removing?.title}”。此操作无法撤销。${error ? " " + error : ""}`}
        confirmLabel="删除"
        pending={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          action(async () => {
            await booksApi.remove(
              removing!.id,
              removing!.revision,
              deleteRequest.current,
            );
            setRemoving(null);
            await client.invalidateQueries({
              queryKey: spreadsheetKeys.all(owner),
            });
          })
        }
      />
    </section>
  );
}
