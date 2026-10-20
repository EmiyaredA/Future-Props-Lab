import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Download,
  ExternalLink,
  FolderOpen,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { download } from "@features/thought-workshop/download";
import {
  createVideoDownloadJob,
  downloadVideoDownloadFile,
  getVideoDownloadDeps,
  getVideoDownloadJob,
  type VideoDownloadBrowser,
  type VideoDownloadJob,
  type VideoDownloadQuality,
} from "@features/tools/api";
import "@features/tools/video-downloader.css";

const DEPS_KEY = ["video-download-deps"] as const;

const QUALITY_OPTIONS = [
  { value: "best", label: "最佳画质" },
  { value: "1080", label: "不超过 1080p" },
  { value: "720", label: "不超过 720p" },
  { value: "480", label: "不超过 480p" },
];

const BROWSER_OPTIONS = [
  { value: "chrome", label: "Chrome" },
  { value: "chromium", label: "Chromium" },
  { value: "edge", label: "Edge" },
  { value: "safari", label: "Safari" },
  { value: "brave", label: "Brave" },
  { value: "firefox", label: "Firefox" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function formatBytes(size: number | null | undefined): string {
  if (size == null || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "下载中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function LinkHelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop video-download-help-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card video-download-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="icon-btn video-download-help-close"
          aria-label="关闭说明"
          onClick={onClose}
        >
          <X aria-hidden />
        </button>
        <h2 id={titleId}>如何获取要下载的视频链接</h2>
        <div className="video-download-help-body">
          <section>
            <h3>抖音 App</h3>
            <ol>
              <li>打开目标视频，点右下角「分享」。</li>
              <li>选择「复制链接」。</li>
              <li>
                回到本工具，整段分享文案可直接粘贴（含
                <code>v.douyin.com</code> 短链即可）。
              </li>
            </ol>
          </section>
          <section>
            <h3>抖音网页</h3>
            <ol>
              <li>
                打开并播放该视频；若在「精选」弹层里，请点进视频页再复制。
              </li>
              <li>
                地址栏优先使用形如{" "}
                <code>https://www.douyin.com/video/数字ID</code>{" "}
                的链接。
              </li>
              <li>
                <code>jingxuan?modal_id=…</code>{" "}
                也可粘贴，工具会自动转成标准视频页。
              </li>
            </ol>
          </section>
          <section>
            <h3>哔哩哔哩</h3>
            <ol>
              <li>打开视频页，复制地址栏链接（含 BV 号）。</li>
              <li>或点「分享 → 复制链接」，短链 <code>b23.tv</code> 也可。</li>
            </ol>
          </section>
          <section>
            <h3>什么时候需要 Cookie</h3>
            <ol>
              <li>
                普通抖音公开视频一般<strong>不需要</strong>
                Cookie，工具会自行解析播放地址。
              </li>
              <li>
                若视频需登录才能看，或 B
                站下载失败提示要登录：开启「从本机浏览器读取 Cookie」。
              </li>
              <li>
                先点「在浏览器打开视频」并播放，再回本页下载；钥匙串弹窗请点允许。
              </li>
            </ol>
          </section>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function VideoDownloaderPage({ onBack }: { onBack: () => void }) {
  const depsQuery = useQuery({
    queryKey: DEPS_KEY,
    queryFn: getVideoDownloadDeps,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<VideoDownloadQuality>("best");
  const [useCookies, setUseCookies] = useState(false);
  const [browser, setBrowser] = useState<VideoDownloadBrowser>("chrome");
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [confirmCookies, setConfirmCookies] = useState(false);
  const [showLinkHelp, setShowLinkHelp] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<VideoDownloadJob | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [downloadingFile, setDownloadingFile] = useState(false);

  const jobQuery = useQuery({
    queryKey: ["video-download-job", jobId],
    queryFn: () => getVideoDownloadJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1200 : false;
    },
    retry: false,
  });

  useEffect(() => {
    const next = jobQuery.data;
    if (!next) return;
    setJob(next);
    if (next.status === "queued" || next.status === "running") {
      setNotice("正在下载，请稍候…");
      setError("");
      return;
    }
    if (next.status === "succeeded") {
      setNotice(
        next.save_to_disk
          ? "下载完成。可点击下方「保存到本机」。"
          : "下载完成，已写入文件库。",
      );
      setError("");
      return;
    }
    if (next.status === "failed") {
      // Keep the failure only in the result panel so it doesn't fight a
      // leftover "正在下载" banner.
      setNotice("");
      setError("");
    }
  }, [jobQuery.data]);

  useEffect(() => {
    if (jobQuery.error) {
      setNotice("");
      setError(errorMessage(jobQuery.error));
    }
  }, [jobQuery.error]);

  const startMutation = useMutation({
    mutationFn: createVideoDownloadJob,
    onSuccess: (created) => {
      setJobId(created.id);
      setJob(created);
      setError("");
      setNotice(
        created.status === "failed"
          ? ""
          : "正在下载，请稍候…",
      );
    },
    onError: (failure) => {
      setError(errorMessage(failure));
      setNotice("");
    },
  });

  const canSubmit =
    Boolean(url.trim()) &&
    !startMutation.isPending &&
    job?.status !== "queued" &&
    job?.status !== "running";

  const requestStart = () => {
    setError("");
    setNotice("");
    if (!url.trim()) {
      setError("请粘贴抖音或哔哩哔哩视频链接。");
      return;
    }
    if (!saveToDisk && !saveToLibrary) {
      setError("请至少选择一种保存方式。");
      return;
    }
    if (useCookies) {
      setConfirmCookies(true);
      return;
    }
    startMutation.mutate({
      url: url.trim(),
      quality,
      use_browser_cookies: false,
      cookies_from_browser: browser,
      save_to_disk: saveToDisk,
      save_to_library: saveToLibrary,
    });
  };

  const confirmAndStart = async () => {
    setConfirmCookies(false);
    startMutation.mutate({
      url: url.trim(),
      quality,
      use_browser_cookies: true,
      cookies_from_browser: browser,
      save_to_disk: saveToDisk,
      save_to_library: saveToLibrary,
    });
  };

  const saveLocalCopy = async () => {
    if (!job || !job.save_to_disk || job.status !== "succeeded") return;
    setDownloadingFile(true);
    setError("");
    try {
      const file = await downloadVideoDownloadFile(job.id);
      download(file.blob, file.filename || job.filename || "video.mp4");
      setNotice("已开始保存到本机。");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setDownloadingFile(false);
    }
  };

  const openInBrowser = () => {
    const target = url.trim();
    if (!target) {
      setError("请先粘贴视频链接，再打开浏览器。");
      return;
    }
    setError("");
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    if (!opened) {
      setError("浏览器拦截了弹窗，请允许本站弹窗后重试，或手动把链接粘到 Chrome。");
      return;
    }
    setNotice(
      `已在系统默认浏览器打开。请用「${
        BROWSER_OPTIONS.find((item) => item.value === browser)?.label || browser
      }」播放该视频并保持登录，然后回到这里点「开始下载」。`,
    );
  };

  const deps = depsQuery.data;

  return (
    <section className="page video-download-page">
      <button className="video-download-back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden /> 返回工具
      </button>
      <header className="video-download-header">
        <span className="video-download-mark">
          <Download aria-hidden />
        </span>
        <div>
          <h1>视频下载</h1>
          <p>粘贴抖音或哔哩哔哩链接，下载到本机并可选写入文件库。</p>
        </div>
      </header>

      <div className="video-download-layout">
        <main className="video-download-panel">
          <div className="video-download-panel-head">
            <h2>下载设置</h2>
            <button
              type="button"
              onClick={() => void depsQuery.refetch()}
              aria-label="刷新依赖状态"
            >
              <RefreshCw aria-hidden /> 刷新依赖
            </button>
          </div>

          <div className="video-download-fields">
            <div className="video-download-label-row">
              <label htmlFor="video-download-url">视频链接</label>
              <button
                type="button"
                className="video-download-help-trigger"
                onClick={() => setShowLinkHelp(true)}
              >
                <CircleHelp aria-hidden /> 如何获取链接
              </button>
            </div>
            <div className="video-download-url video-download-url-multiline">
              <Link2 aria-hidden />
              <textarea
                id="video-download-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴抖音/B站链接，或 App「复制链接」得到的整段分享文案"
                autoComplete="off"
                spellCheck={false}
                rows={3}
              />
            </div>
            <p className="video-download-hint">
              支持分享短链、标准视频页，以及抖音精选页的{" "}
              <code>modal_id</code> 链接。
            </p>

            <label htmlFor="video-download-quality">清晰度</label>
            <CustomSelect
              ariaLabel="清晰度"
              value={quality}
              options={QUALITY_OPTIONS}
              onChange={(value) => setQuality(value as VideoDownloadQuality)}
            />

            <label className="video-download-check">
              <input
                type="checkbox"
                checked={useCookies}
                onChange={(event) => setUseCookies(event.target.checked)}
              />
              <span>从本机浏览器读取 Cookie（登录可见 / B 站需要时）</span>
            </label>

            {useCookies ? (
              <>
                <label htmlFor="video-download-browser">读取哪个浏览器的 Cookie</label>
                <CustomSelect
                  ariaLabel="浏览器"
                  value={browser}
                  options={BROWSER_OPTIONS}
                  onChange={(value) =>
                    setBrowser(value as VideoDownloadBrowser)
                  }
                />
                <ol className="video-download-steps">
                  <li>
                    点「在浏览器打开视频」，用上面选的浏览器打开并播放（保持登录）。
                  </li>
                  <li>等视频能播起来后，回到本页。</li>
                  <li>
                    再点「开始下载」；工具会读取该浏览器 Cookie（可能弹出钥匙串确认）。普通抖音公开视频通常不必开此项。
                  </li>
                </ol>
                <button
                  type="button"
                  className="video-download-secondary"
                  disabled={!url.trim()}
                  onClick={openInBrowser}
                >
                  <ExternalLink aria-hidden /> 在浏览器打开视频
                </button>
              </>
            ) : null}

            <fieldset className="video-download-destinations">
              <legend>保存到</legend>
              <label className="video-download-check">
                <input
                  type="checkbox"
                  checked={saveToDisk}
                  onChange={(event) => setSaveToDisk(event.target.checked)}
                />
                <span>本机下载（浏览器另存）</span>
              </label>
              <label className="video-download-check">
                <input
                  type="checkbox"
                  checked={saveToLibrary}
                  onChange={(event) => setSaveToLibrary(event.target.checked)}
                />
                <span>Workspace 文件库</span>
              </label>
            </fieldset>
          </div>

          <div className="video-download-actions">
            <button
              type="button"
              className="primary"
              disabled={!canSubmit}
              onClick={requestStart}
            >
              开始下载
            </button>
          </div>

          {error ? (
            <div className="video-download-message error" role="alert">
              {error}
            </div>
          ) : null}
          {notice && !error ? (
            <div className="video-download-message success" role="status">
              {notice}
            </div>
          ) : null}

          {job ? (
            <div
              className={`video-download-result status-${job.status}`}
              aria-live="polite"
            >
              <div className="video-download-result-head">
                {job.status === "succeeded" ? (
                  <CheckCircle2 aria-hidden />
                ) : null}
                {job.status === "failed" ? <CircleAlert aria-hidden /> : null}
                {job.status === "queued" || job.status === "running" ? (
                  <LoaderCircle
                    className="video-download-spin"
                    aria-hidden
                  />
                ) : null}
                <strong>{statusLabel(job.status)}</strong>
              </div>
              {job.status === "failed" && job.error ? (
                <>
                  <p className="video-download-result-error">{job.error}</p>
                  <div className="video-download-result-actions">
                    <button
                      type="button"
                      className="video-download-secondary"
                      disabled={!url.trim()}
                      onClick={openInBrowser}
                    >
                      <ExternalLink aria-hidden /> 先在浏览器打开并播放
                    </button>
                  </div>
                </>
              ) : null}
              {job.status !== "failed" ? (
                <dl>
                  <div>
                    <dt>标题</dt>
                    <dd>{job.title || "—"}</dd>
                  </div>
                  <div>
                    <dt>文件</dt>
                    <dd>{job.filename || "—"}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatBytes(job.byte_size)}</dd>
                  </div>
                  {job.asset ? (
                    <div>
                      <dt>文件库</dt>
                      <dd>
                        已写入「{job.asset.display_name}」（
                        {formatBytes(job.asset.byte_size)}）
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <div className="video-download-result-actions">
                {job.status === "succeeded" && job.save_to_disk ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={downloadingFile}
                    onClick={() => void saveLocalCopy()}
                  >
                    <Download aria-hidden />{" "}
                    {downloadingFile ? "准备中…" : "保存到本机"}
                  </button>
                ) : null}
                {job.status === "succeeded" && job.asset ? (
                  <a className="video-download-library-link" href="/files">
                    <FolderOpen aria-hidden /> 打开文件管理
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </main>

        <aside className="video-download-panel video-download-status">
          <h2>本机依赖</h2>
          {depsQuery.isLoading ? <p role="status">正在检查…</p> : null}
          {depsQuery.isError ? (
            <div className="video-download-message error" role="alert">
              {errorMessage(depsQuery.error)}
            </div>
          ) : null}
          {deps ? (
            <>
              <div
                className={`video-download-ready ${deps.ready ? "ok" : "warn"}`}
              >
                <ShieldCheck aria-hidden />
                <span>
                  {deps.ready
                    ? "yt-dlp 与 ffmpeg 已就绪"
                    : "请先安装缺失的本机程序"}
                </span>
              </div>
              <dl>
                <div>
                  <dt>yt-dlp</dt>
                  <dd>
                    {deps.yt_dlp.ok
                      ? deps.yt_dlp.version || deps.yt_dlp.path || "可用"
                      : deps.yt_dlp.hint || "未找到"}
                  </dd>
                </div>
                <div>
                  <dt>ffmpeg</dt>
                  <dd>
                    {deps.ffmpeg.ok
                      ? deps.ffmpeg.version || deps.ffmpeg.path || "可用"
                      : deps.ffmpeg.hint || "未找到"}
                  </dd>
                </div>
              </dl>
              <p className="video-download-hint">
                仅支持抖音与哔哩哔哩单条视频，不下载整个播放列表。Cookie
                只在本机用于当次下载，不会写入数据库或回传前端。
              </p>
            </>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCookies}
        tone="primary"
        title="读取浏览器 Cookie？"
        description={
          <>
            将从本机{" "}
            {BROWSER_OPTIONS.find((item) => item.value === browser)?.label ||
              browser}{" "}
            读取登录 Cookie，用于需登录才可看的视频（含部分 B
            站内容）。系统可能再弹出钥匙串或浏览器授权提示。确认后才会开始下载。
          </>
        }
        confirmLabel="允许并下载"
        cancelLabel="取消"
        pending={startMutation.isPending}
        onCancel={() => setConfirmCookies(false)}
        onConfirm={confirmAndStart}
      />
      <LinkHelpDialog
        open={showLinkHelp}
        onClose={() => setShowLinkHelp(false)}
      />
    </section>
  );
}
