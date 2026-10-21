import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { getStorageUsage, openStorageDirectory } from "./storageUsageApi";
import "./storage-usage.css";

function capacityLabel(bytes: number): string {
  return `${(bytes / 1_000_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} GB`;
}

export function StorageUsagePage({
  onBack,
  allowed,
}: {
  onBack: () => void;
  allowed: boolean;
}) {
  const picker = window.futurePropsDesktop?.pickStorageDirectory;
  const available = allowed && Boolean(picker);
  const [directory, setDirectory] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["storage-usage", directory],
    queryFn: () => getStorageUsage(directory),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const mutation = useMutation({
    mutationFn: ({ path, analyze }: { path: string; analyze: boolean }) =>
      openStorageDirectory(path, analyze),
    retry: false,
    onSuccess: (_receipt, { analyze }) => {
      setNotice(
        analyze
          ? "已发送 GrandPerspective 打开请求，请在原生窗口中查看扫描进度与占用图。"
          : "已发送 Finder 打开请求，可在其中手动整理目录。",
      );
    },
    onError: (failure) =>
      setError(
        failure instanceof Error ? failure.message : "打开失败，请重试。",
      ),
  });
  const data = query.data;
  const busy = picking || mutation.isPending || query.isFetching;
  const select = (path: string) => {
    setNotice("");
    setError("");
    if (path === directory) void query.refetch();
    else setDirectory(path);
  };
  const pick = async () => {
    if (!picker || busy) return;
    setPicking(true);
    setError("");
    try {
      const selected = await picker();
      if (selected) select(selected);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "无法选择目录，请重试。",
      );
    } finally {
      setPicking(false);
    }
  };
  const open = (analyze: boolean) => {
    if (!data || busy) return;
    setNotice("");
    setError("");
    mutation.mutate({ path: data.directory, analyze });
  };
  const percentage =
    data && data.capacity.total_bytes > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (data.capacity.used_bytes / data.capacity.total_bytes) * 100,
          ),
        )
      : 0;

  return (
    <section className="page storage-usage-page">
      <button className="storage-back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden />
        返回工具
      </button>
      <header className="storage-header">
        <span className="storage-mark">
          <HardDrive aria-hidden />
        </span>
        <div>
          <h1>空间占用</h1>
          <p>查看容量，找到占空间的目录，再到 Finder 中手动整理。</p>
        </div>
      </header>
      {!available ? (
        <div className="storage-panel" role="status">
          此工具仅供 macOS
          桌面版的平台超级管理员使用。请使用支持目录选择的桌面版本。
        </div>
      ) : (
        <>
          <div className="storage-panel storage-analyzer">
            <div>
              <h2>GrandPerspective</h2>
              <p>
                {data
                  ? data.analyzer.installed
                    ? `已安装 · ${data.analyzer.version}`
                    : "未检测到可用安装"
                  : "等待检测安装状态"}
              </p>
            </div>
            <div className="storage-actions">
              {data && !data.analyzer.installed && (
                <a
                  href="https://grandperspectiv.sourceforge.net/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  前往官网下载
                  <ExternalLink aria-hidden />
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNotice("");
                  setError("");
                  void query.refetch();
                }}
              >
                <RefreshCw aria-hidden />
                {query.isFetching ? "正在读取…" : "刷新容量 / 重新检测"}
              </button>
            </div>
          </div>
          <div className="storage-panel">
            <h2>选择分析目录</h2>
            <div className="storage-shortcuts">
              {(data?.shortcuts ?? []).map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  disabled={busy || !shortcut.available}
                  aria-pressed={data?.directory === shortcut.directory}
                  onClick={() => select(shortcut.directory)}
                >
                  {shortcut.label}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => void pick()}>
                <FolderOpen aria-hidden />
                {picking ? "正在选择…" : "选择其他目录"}
              </button>
            </div>
            <p className="storage-path">
              {data?.directory ?? directory ?? "主目录"}
            </p>
            {data && (
              <>
                <div className="storage-capacity-heading">
                  <h2>当前目录所在磁盘</h2>
                  <span>{percentage.toFixed(1)}% 已用</span>
                </div>
                <div
                  className="storage-meter"
                  role="progressbar"
                  aria-label="磁盘已用空间"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percentage)}
                >
                  <span style={{ width: `${percentage}%` }} />
                </div>
                <dl className="storage-capacity">
                  {[
                    ["总容量", data.capacity.total_bytes],
                    ["已用", data.capacity.used_bytes],
                    ["可用", data.capacity.free_bytes],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{capacityLabel(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
                <p className="storage-hint">
                  这里显示所在磁盘的容量，不是此目录的大小；与 macOS
                  储存空间的分类及可清除空间统计可能不同。
                </p>
                <div className="storage-actions">
                  <button
                    className="storage-primary"
                    type="button"
                    disabled={busy || !data.analyzer.installed}
                    onClick={() => open(true)}
                  >
                    <HardDrive aria-hidden />
                    可视化分析 · 打开 GrandPerspective
                    <ExternalLink aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => open(false)}
                  >
                    <FolderOpen aria-hidden />在 Finder 中打开
                  </button>
                </div>
              </>
            )}
            {query.isFetching && <p role="status">正在读取磁盘容量…</p>}
          </div>
          <div className="storage-panel storage-guide">
            <h2>从占用图找到目录</h2>
            <ol>
              <li>
                点击“可视化分析”，在 GrandPerspective 原生窗口等待扫描完成。
              </li>
              <li>点击大色块锁定文件，调整 Focus 查看所在目录。</li>
              <li>
                使用 Reveal（在 Finder 中显示）进入目录，确认内容后手动整理。
              </li>
              <li>
                整理后在 GrandPerspective 中 Refresh 或
                Rescan，返回本页可刷新磁盘容量。
              </li>
            </ol>
            <p className="storage-hint">
              详细扫描与图形由 GrandPerspective
              完成。此工具不保存扫描结果，也不持续扫描磁盘。完整扫描所需的访问权限请在
              GrandPerspective 中按提示设置。
            </p>
          </div>
          {(error || query.error) && (
            <p className="storage-error" role="alert">
              {error ||
                (query.error instanceof Error
                  ? query.error.message
                  : "读取失败，请刷新重试。")}
            </p>
          )}
          {notice && (
            <p className="storage-notice" role="status">
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
