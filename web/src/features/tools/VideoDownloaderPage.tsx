import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  Link2,
  RefreshCw,
  ShieldCheck,
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

export function VideoDownloaderPage({ onBack }: { onBack: () => void }) {
  const depsQuery = useQuery({
    queryKey: DEPS_KEY,
    queryFn: getVideoDownloadDeps,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<VideoDownloadQuality>("best");
  const [useCookies, setUseCookies] = useState(true);
  const [browser, setBrowser] = useState<VideoDownloadBrowser>("chrome");
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [confirmCookies, setConfirmCookies] = useState(false);
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
    if (jobQuery.data) setJob(jobQuery.data);
  }, [jobQuery.data]);

  useEffect(() => {
    if (jobQuery.error) setError(errorMessage(jobQuery.error));
  }, [jobQuery.error]);

  const startMutation = useMutation({
    mutationFn: createVideoDownloadJob,
    onSuccess: (created) => {
      setJobId(created.id);
      setJob(created);
      setError("");
      setNotice("已开始下载，请稍候…");
    },
    onError: (failure) => {
      setError(errorMessage(failure));
      setNotice("");
    },
  });

  const canSubmit =
    Boolean(url.trim()) &&
    (saveToDisk || saveToLibrary) &&
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
            <label htmlFor="video-download-url">视频链接</label>
            <div className="video-download-url">
              <Link2 aria-hidden />
              <input
                id="video-download-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.bilibili.com/video/… 或抖音分享链接"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

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
              <span>从本机浏览器读取 Cookie（抖音常需要）</span>
            </label>

            {useCookies ? (
              <>
                <label htmlFor="video-download-browser">浏览器</label>
                <CustomSelect
                  ariaLabel="浏览器"
                  value={browser}
                  options={BROWSER_OPTIONS}
                  onChange={(value) =>
                    setBrowser(value as VideoDownloadBrowser)
                  }
                />
                <p className="video-download-hint">
                  确认后将读取该浏览器中已登录的抖音 / B
                  站 Cookie。系统可能再弹出钥匙串或浏览器授权提示。
                </p>
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
            <div className="video-download-result" aria-live="polite">
              <div className="video-download-result-head">
                <strong>{statusLabel(job.status)}</strong>
                {job.status === "succeeded" ? (
                  <CheckCircle2 aria-hidden />
                ) : null}
              </div>
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
                {job.error ? (
                  <div>
                    <dt>错误</dt>
                    <dd>{job.error}</dd>
                  </div>
                ) : null}
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
            将从本机 {BROWSER_OPTIONS.find((item) => item.value === browser)?.label || browser}{" "}
            读取抖音与哔哩哔哩的登录 Cookie，以便下载需要登录的视频。系统可能再弹出钥匙串或浏览器授权提示。确认后才会开始下载。
          </>
        }
        confirmLabel="允许并下载"
        cancelLabel="取消"
        pending={startMutation.isPending}
        onCancel={() => setConfirmCookies(false)}
        onConfirm={confirmAndStart}
      />
    </section>
  );
}
