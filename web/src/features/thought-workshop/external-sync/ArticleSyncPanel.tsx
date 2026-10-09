import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  FileText,
  CheckCircle2,
  Clock3,
  AlertCircle,
  Link2,
  Unlink,
} from "lucide-react";
import { FeishuMark } from "@shared/ui/FeishuMark";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SyncConfirmation } from "./SyncConfirmation";
import {
  getExternalConnections,
  checkExternalTarget,
  integrationKeys,
} from "@features/integrations";
import { thoughtKeys } from "../queryKeys";
import { getNote, type Note } from "../api";
import {
  bindArticle,
  getArticleSync,
  previewArticle,
  reconcileArticle,
  submitArticle,
  unbindArticle,
  type SyncPreview,
} from "./api";
import "./article-sync.css";

const STATUS: Record<string, string> = {
  queued: "等待同步",
  running: "同步中",
  succeeded: "同步成功",
  failed: "同步失败",
  conflict: "目标有修改",
  needs_review: "需要核对",
};

export function ArticleSyncPanel({
  note,
  save,
  close,
}: {
  note: Note;
  save?: () => Promise<Note>;
  close: () => void;
}) {
  const key = thoughtKeys.externalSync(note.id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => getArticleSync(note.id),
    refetchOnMount: "always",
    refetchInterval: (q) =>
      q.state.data?.tasks.some((t) => ["queued", "running"].includes(t.status))
        ? 1500
        : false,
  });
  const connections = useQuery({
    queryKey: integrationKeys.catalog("external-connections"),
    queryFn: getExternalConnections,
  });
  const client = useQueryClient();
  const [connection, setConnection] = useState("");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<Awaited<
    ReturnType<typeof checkExternalTarget>
  > | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [operationId, setOperationId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"sync" | "unbind" | "end" | null>(
    null,
  );
  const [remoteText, setRemoteText] = useState("");
  const binding = state.data?.binding;
  const latest = state.data?.tasks[0];
  const unresolved = state.data?.tasks.find((t) =>
    ["queued", "running", "needs_review"].includes(t.status),
  );
  async function action(work: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await work();
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步操作失败");
    } finally {
      setPending(false);
    }
  }
  async function prepare() {
    if (!binding) return;
    const saved = save ? await save() : await getNote(note.id);
    const result = await previewArticle(
      note.id,
      saved.revision,
      binding.revision,
    );
    setPreview(result);
    setOperationId(crypto.randomUUID());
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending && !confirm) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="article-sync-overlay" />
        <Dialog.Content
          className="article-sync-panel"
          aria-describedby="article-sync-description"
          onEscapeKeyDown={(event) => {
            if (confirm || pending) {
              event.preventDefault();
              if (!pending) setConfirm(null);
            }
          }}
          onInteractOutside={(event) => {
            if (confirm || pending) event.preventDefault();
          }}
        >
          <header>
            <div className="article-sync-heading">
              {binding ? (
                <FeishuMark size={40} />
              ) : (
                <span className="article-sync-platform-icon">
                  <Link2 size={22} aria-hidden />
                </span>
              )}
              <div>
                <Dialog.Title>文章同步</Dialog.Title>
                <Dialog.Description id="article-sync-description">
                  手动将已保存文章同步到指定外部文档。
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="article-sync-close"
              aria-label="关闭文章同步"
              disabled={pending}
            >
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="article-sync-scroll">
            {(error || state.error || connections.error) && (
              <p className="article-sync-error" role="alert">
                {error || state.error?.message || connections.error?.message}
              </p>
            )}
            {state.isPending && <p role="status">正在读取同步配置…</p>}
            {binding ? (
              <>
                <section className="article-sync-card">
                  <div className="article-sync-target-heading">
                    <div>
                      <span className="article-sync-eyebrow">目标文档</span>
                      <strong>{binding.title}</strong>
                      <p>
                        {connections.data?.items.find(
                          (c) => c.id === binding.connection_id,
                        )?.name || "飞书连接"}
                      </p>
                    </div>
                    <a
                      className="article-sync-open-link"
                      href={binding.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} /> 打开飞书文档
                    </a>
                  </div>
                  <div className="article-sync-target-meta">
                    <p
                      className={`article-sync-status ${unresolved?.status || (preview?.remote_changed ? "conflict" : binding.last_note_revision === note.revision ? "succeeded" : "idle")}`}
                      role="status"
                    >
                      {unresolved?.status === "needs_review" ||
                      preview?.remote_changed ? (
                        <AlertCircle size={14} />
                      ) : binding.last_note_revision === note.revision &&
                        !unresolved ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <Clock3 size={14} />
                      )}
                      {unresolved
                        ? STATUS[unresolved.status]
                        : preview?.remote_changed
                          ? "飞书正文有修改"
                          : binding.last_note_revision === null
                            ? "尚未同步"
                            : binding.last_note_revision === note.revision
                              ? "本地版本已同步"
                              : "有修改待同步"}
                    </p>
                    <span>手动同步 · 整篇正文</span>
                  </div>
                  {binding.last_synced_at && (
                    <small>
                      上次同步：
                      {new Date(binding.last_synced_at).toLocaleString()}
                    </small>
                  )}
                </section>
                {!preview && (
                  <button
                    className="btn primary article-sync-prepare"
                    disabled={pending || !!unresolved}
                    onClick={() => void action(prepare)}
                  >
                    <RefreshCw size={16} /> 预览并同步
                  </button>
                )}
                {unresolved?.status === "running" && (
                  <p className="article-sync-warning" role="status">
                    正在写入新内容，飞书文档可能暂时同时显示新旧正文。旧正文将在新内容核验完成后移除。
                  </p>
                )}
                {unresolved?.status === "needs_review" && (
                  <section className="article-sync-card">
                    <strong>同步结果需要核对</strong>
                    <p>{unresolved.message}</p>
                    <div className="article-sync-recovery-actions">
                      <button
                        className="btn"
                        disabled={pending}
                        onClick={() =>
                          void action(async () => {
                            const result = await reconcileArticle(
                              note.id,
                              unresolved.id,
                            );
                            setRemoteText(result.remote_text);
                          })
                        }
                      >
                        核对远端并尝试继续
                      </button>
                      <button
                        className="btn"
                        disabled={pending}
                        onClick={() => setConfirm("end")}
                      >
                        我已核对，结束此任务
                      </button>
                    </div>
                    {remoteText && (
                      <pre className="article-sync-text">{remoteText}</pre>
                    )}
                  </section>
                )}
                {preview && (
                  <section className="article-sync-preview">
                    <div className="article-sync-section-heading">
                      <h3>同步预览</h3>
                      <span>文章版本 {preview.note_revision}</span>
                    </div>
                    <p className="article-sync-preview-target">
                      同步到 {preview.target_title}
                    </p>
                    {preview.blockers.length > 0 && (
                      <div role="alert" className="article-sync-error">
                        <strong>以下内容暂不支持同步</strong>
                        <ul>
                          {preview.blockers.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {preview.warnings.length > 0 && (
                      <ul className="article-sync-warning">
                        {preview.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {preview.remote_changed && (
                      <p role="alert" className="article-sync-warning">
                        飞书正文与上次同步结果不同。请比较双方内容后，再决定是否覆盖。
                      </p>
                    )}
                    <div className="article-sync-comparison">
                      <div>
                        <h4>
                          <FileText size={15} aria-hidden />
                          思绪工坊<span>本次内容</span>
                        </h4>
                        <pre className="article-sync-text">
                          {preview.local_text}
                        </pre>
                      </div>
                      <div>
                        <h4>
                          <FeishuMark size={20} />
                          飞书<span>当前正文</span>
                        </h4>
                        <pre className="article-sync-text">
                          {preview.remote_text || "（空文档）"}
                        </pre>
                      </div>
                    </div>
                    <p className="article-sync-replace-hint">
                      保留飞书文档标题；本次内容将替换目标的整篇正文。图片将上传至飞书。
                    </p>
                    <div className="article-sync-actions">
                      <button
                        className="btn"
                        disabled={pending}
                        onClick={() => setPreview(null)}
                      >
                        返回
                      </button>
                      <button
                        className="btn primary"
                        disabled={
                          pending ||
                          !preview.preview_id ||
                          !!preview.blockers.length
                        }
                        onClick={() => setConfirm("sync")}
                      >
                        确认并同步
                      </button>
                    </div>
                  </section>
                )}
                <section className="article-sync-history">
                  <div className="article-sync-section-heading">
                    <h3>最近记录</h3>
                    <span>同步历史</span>
                  </div>
                  {state.data?.tasks.map((task) => (
                    <div key={task.id} className="article-sync-history-item">
                      <span
                        className={`article-sync-history-icon ${task.status}`}
                      >
                        {task.status === "succeeded" ? (
                          <CheckCircle2 size={17} />
                        ) : ["needs_review", "failed", "conflict"].includes(
                            task.status,
                          ) ? (
                          <AlertCircle size={17} />
                        ) : (
                          <Clock3 size={17} />
                        )}
                      </span>
                      <div>
                        <div className="article-sync-history-row">
                          <strong>{STATUS[task.status]}</strong>
                          <small>
                            {new Date(task.updated_at).toLocaleString()}
                          </small>
                        </div>
                        <p>
                          {task.message || `同步文章版本 ${task.note_revision}`}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!latest && <p>尚无同步记录</p>}
                </section>
                <div className="article-sync-unbind-row">
                  <small>解除绑定后保留飞书文档</small>
                  <button
                    className="article-sync-unbind"
                    disabled={pending || !!unresolved}
                    onClick={() => setConfirm("unbind")}
                  >
                    <Unlink size={14} aria-hidden />
                    解除绑定
                  </button>
                </div>
              </>
            ) : (
              !state.isPending && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const resolved = target?.url;
                    if (!resolved) return;
                    void action(async () => {
                      await bindArticle(note.id, connection, resolved, 0);
                      setTarget(null);
                    });
                  }}
                >
                  <div className="article-sync-bind-intro">
                    <span>
                      <Link2 size={19} aria-hidden />
                    </span>
                    <div>
                      <h3>绑定一个专用文档</h3>
                      <p>
                        选择连接，粘贴飞书新版文档链接。知识库中的文档可直接粘贴
                        /wiki/ 链接。
                      </p>
                    </div>
                  </div>
                  <label>
                    <span>使用连接</span>
                    <CustomSelect
                      disabled={pending}
                      ariaLabel="使用连接"
                      value={connection}
                      onChange={(value) => {
                        setConnection(value);
                        setTarget(null);
                      }}
                      options={[
                        { value: "", label: "选择飞书连接" },
                        ...(connections.data?.items
                          .filter((c) => c.enabled)
                          .map((c) => ({ value: c.id, label: c.name })) || []),
                      ]}
                    />
                  </label>
                  {!connections.isPending &&
                    !connections.data?.items.some((c) => c.enabled) && (
                      <p>
                        尚无可用连接，请到
                        <a href="/integrations/external-connections">
                          集成中心配置外部连接
                        </a>
                        。
                      </p>
                    )}
                  <label>
                    <span>目标文档链接</span>
                    <input
                      disabled={pending}
                      required
                      type="url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setTarget(null);
                      }}
                      placeholder="https://你的企业.feishu.cn/docx/… 或 /wiki/…"
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    disabled={pending || !connection || !url}
                    onClick={() =>
                      void action(async () => {
                        const checked = await checkExternalTarget(
                          connection,
                          url,
                        );
                        setTarget(checked);
                        setUrl(checked.url);
                      })
                    }
                  >
                    检查目标
                  </button>
                  {target && (
                    <section className="article-sync-card">
                      <strong>{target.title}</strong>
                      <p>
                        {target.can_write
                          ? "应用具有编辑权限"
                          : "应用没有编辑权限"}
                      </p>
                      <pre className="article-sync-text">
                        {target.text || "（空文档）"}
                      </pre>
                    </section>
                  )}
                  <p className="article-sync-warning">
                    目标将作为文章的专用同步副本。执行同步时会更新整篇正文，首次操作前请确认现有内容可以被替换。
                  </p>
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={pending || !target?.can_write}
                  >
                    绑定文档 <ArrowRight size={15} aria-hidden />
                  </button>
                </form>
              )
            )}
          </div>
          <SyncConfirmation
            open={confirm !== null}
            title={
              confirm === "sync"
                ? preview?.remote_changed
                  ? "覆盖飞书当前正文？"
                  : "替换飞书整篇正文？"
                : confirm === "unbind"
                  ? "解除文章绑定？"
                  : "结束待核对任务？"
            }
            description={
              <>
                {error && <p role="alert">{error}</p>}
                {confirm === "sync"
                  ? "将使用预览中的文章内容替换飞书正文。若目标再次变化，同步会暂停。"
                  : confirm === "unbind"
                    ? "飞书文档会保留，后续不再从本文章同步。"
                    : "请先打开飞书检查部分写入结果。结束后保留远端现场，下一次同步需要重新预览并确认替换。"}
              </>
            }
            confirmLabel={confirm === "sync" ? "确认替换并同步" : "确认"}
            pending={pending}
            onCancel={() => setConfirm(null)}
            onConfirm={() =>
              action(async () => {
                if (confirm === "sync" && preview?.preview_id) {
                  await submitArticle(note.id, preview.preview_id, operationId);
                  setPreview(null);
                } else if (confirm === "unbind" && binding) {
                  await unbindArticle(note.id, binding.revision);
                  setPreview(null);
                } else if (confirm === "end" && unresolved)
                  await reconcileArticle(note.id, unresolved.id, true);
                setConfirm(null);
              })
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
