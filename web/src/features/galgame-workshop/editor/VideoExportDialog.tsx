import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Film, LoaderCircle, X } from "lucide-react";
import {
  cancelGalgameVideoExport,
  createGalgameVideoExport,
  downloadGalgameVideoExport,
  listGalgameVideoExports,
  previewGalgameVideoExport,
  type GalgameVideoExportBranchSelection,
  type GalgameVideoExportPreset,
} from "@features/galgame-workshop/api";
import "@features/galgame-workshop/editor/video-export.css";

const PRESETS: Array<{
  id: GalgameVideoExportPreset;
  label: string;
  detail: string;
}> = [
  { id: "1080p30", label: "1080p / 30", detail: "推荐 · 画质与速度平衡" },
  { id: "720p30", label: "720p / 30", detail: "文件更小、导出更快" },
  { id: "1080p60", label: "1080p / 60", detail: "更流畅、性能要求更高" },
];

function languageLabel(locale: string) {
  const language = locale.toLocaleLowerCase();
  if (language.startsWith("zh")) return `中文 · ${locale}`;
  if (language.startsWith("ja")) return `日语 · ${locale}`;
  if (language.startsWith("en")) return `英语 · ${locale}`;
  return locale;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, "0"),
    )
    .join(":");
}

const phaseLabel: Record<string, string> = {
  queued: "排队中",
  preparing: "准备素材",
  rendering: "自动播放与渲染",
  encoding: "编码 MP4",
  verifying: "校验成片",
  registering: "保存到资产库",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function VideoExportDialog({
  open,
  projectId,
  storyRevision,
  languageOptions,
  onClose,
}: {
  open: boolean;
  projectId: string;
  storyRevision: number;
  languageOptions: string[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [preset, setPreset] = useState<GalgameVideoExportPreset>("1080p30");
  const preferredLocale =
    languageOptions.find((item) => item.toLocaleLowerCase().startsWith("zh")) ??
    languageOptions[0] ??
    "zh";
  const [locale, setLocale] = useState(preferredLocale);
  const [selections, setSelections] = useState<
    GalgameVideoExportBranchSelection[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setSelections([]);
    setError("");
    setLocale(preferredLocale);
  }, [open, preferredLocale, storyRevision]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  const previewBody = useMemo(
    () => ({
      expectedStoryRevision: storyRevision,
      locale,
      preset,
      branchSelections: selections,
    }),
    [locale, preset, selections, storyRevision],
  );
  const preview = useQuery({
    queryKey: ["galgame-video-export-preview", projectId, previewBody],
    queryFn: () => previewGalgameVideoExport(projectId, previewBody),
    enabled: open,
    retry: false,
  });
  const tasks = useQuery({
    queryKey: ["galgame-video-exports", projectId],
    queryFn: () => listGalgameVideoExports(projectId),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.status),
      )
        ? 1500
        : false,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!preview.data?.ready) throw new Error("请先完成路线选择和检查");
      return createGalgameVideoExport(projectId, {
        ...previewBody,
        requestId: `export-${crypto.randomUUID()}`,
        previewFingerprint: preview.data.previewFingerprint,
      });
    },
    onSuccess: async () => {
      setError("");
      await client.invalidateQueries({
        queryKey: ["galgame-video-exports", projectId],
      });
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "无法开始视频导出"),
  });
  const cancel = useMutation({
    mutationFn: (exportId: string) =>
      cancelGalgameVideoExport(projectId, exportId),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["galgame-video-exports", projectId],
      }),
  });
  if (!open) return null;
  const decision = preview.data?.nextDecision;
  return (
    <div className="galgame-video-export-backdrop" role="presentation">
      <section
        className="galgame-video-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出 Galgame 视频"
      >
        <header>
          <span>
            <Film aria-hidden />
            <span>
              <strong>导出视频</strong>
              <small>按选定路线后台自动播放并生成 MP4</small>
            </span>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭视频导出">
            <X aria-hidden />
          </button>
        </header>
        <div className="galgame-video-export-content">
          <section>
            <h3>语言</h3>
            <div className="galgame-video-languages">
              {languageOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={locale === item ? "active" : ""}
                  onClick={() => setLocale(item)}
                >
                  {languageLabel(item)}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>画质</h3>
            <div className="galgame-video-presets">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={preset === item.id ? "active" : ""}
                  onClick={() => setPreset(item.id)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>路线</h3>
            {preview.isLoading ? (
              <p className="galgame-video-export-loading">
                <LoaderCircle className="spinning" aria-hidden /> 正在检查路线…
              </p>
            ) : decision ? (
              <div className="galgame-video-decision">
                <strong>{decision.prompt || "请选择路线"}</strong>
                <div>
                  {decision.choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() =>
                        setSelections((current) => [
                          ...current.filter(
                            (item) =>
                              item.branchBlockId !== decision.branchBlockId,
                          ),
                          {
                            branchBlockId: decision.branchBlockId,
                            choiceId: choice.id,
                          },
                        ])
                      }
                    >
                      {choice.text || "未命名选项"}
                    </button>
                  ))}
                </div>
              </div>
            ) : preview.data?.ready ? (
              <div className="galgame-video-route-ready">
                <Check aria-hidden />
                <span>
                  <strong>{preview.data.route.endingLabel}</strong>
                  <small>
                    {preview.data.route.branchBlockIds.length
                      ? `已选择 ${preview.data.route.branchBlockIds.length} 个分支`
                      : "当前路线没有分支选项"}
                  </small>
                </span>
                <time>
                  {formatDuration(preview.data.route.estimatedDurationMs)}
                  {!preview.data.route.exactDuration ? "（预计）" : ""}
                </time>
                {selections.length ? (
                  <button type="button" onClick={() => setSelections([])}>
                    重选路线
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="galgame-video-export-issues">
                {(preview.data?.blockers ?? []).map((issue) => (
                  <p key={`${issue.code}-${issue.path}`}>{issue.message}</p>
                ))}
                {preview.error ? <p>{preview.error.message}</p> : null}
              </div>
            )}
            {(preview.data?.warnings ?? []).map((issue) => (
              <p
                className="galgame-video-export-warning"
                key={`${issue.code}-${issue.path}`}
              >
                {issue.message}
              </p>
            ))}
          </section>
          {error ? (
            <p className="galgame-video-export-error-text">{error}</p>
          ) : null}
          <button
            type="button"
            className="galgame-video-export-start"
            disabled={!preview.data?.ready || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <LoaderCircle className="spinning" aria-hidden />
            ) : (
              <Film aria-hidden />
            )}
            开始后台导出
          </button>
          <section className="galgame-video-history">
            <h3>导出记录</h3>
            {tasks.data?.items.length ? (
              tasks.data.items.map((task) => (
                <article key={task.id}>
                  <div>
                    <strong>
                      {task.outputFilename || task.endingLabel || "视频导出"}
                    </strong>
                    <small>
                      {phaseLabel[task.phase] || task.phase} · {task.preset}
                      {task.totalMs
                        ? ` · ${formatDuration(task.renderedMs)} / ${formatDuration(task.totalMs)}`
                        : ""}
                    </small>
                  </div>
                  <progress max="100" value={task.progress} />
                  <span>{task.progress}%</span>
                  {task.status === "completed" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void downloadGalgameVideoExport(
                          projectId,
                          task.id,
                          task.outputFilename || "galgame-export.mp4",
                        )
                      }
                    >
                      <Download aria-hidden /> 下载
                    </button>
                  ) : ["queued", "running"].includes(task.status) ? (
                    <button
                      type="button"
                      onClick={() => cancel.mutate(task.id)}
                    >
                      取消
                    </button>
                  ) : null}
                  {task.error ? <p>{task.error}</p> : null}
                </article>
              ))
            ) : (
              <p className="galgame-video-empty">还没有导出记录</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
