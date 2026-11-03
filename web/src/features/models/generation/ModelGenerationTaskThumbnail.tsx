import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";
import { statusLabel } from "./modelGenerationOptions";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useEffect, useRef, useState } from "react";
import { Image, Video } from "lucide-react";
import {
  getModelTestGenerationResult,
  type ModelTestGenerationTask,
} from "@features/models/api";

export function TaskThumbnail({ task }: { task: ModelTestGenerationTask }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible || !root.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "120px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    let objectUrl = "";
    let disposed = false;
    setUrl("");
    setFailed(false);
    if (!visible || !task.result_available) return;
    void getModelTestGenerationResult(
      task.id,
      task.kind === "image" ? 320 : undefined,
    )
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task.id, task.kind, task.result_available, visible]);

  const fallback =
    task.status === "completed" && task.result_available && !failed ? (
      <LoadingScene />
    ) : task.kind === "image" ? (
      <Image aria-hidden />
    ) : (
      <Video aria-hidden />
    );

  return (
    <div className={`generation-task-thumbnail ${task.kind}`} ref={root}>
      {url && task.kind === "image" ? (
        <ResponsiveImage src={url} alt="" />
      ) : null}
      {url && task.kind === "video" ? (
        <video src={url} muted preload="metadata" aria-hidden />
      ) : null}
      {!url ? fallback : null}
    </div>
  );
}

export function GenerationResultPending({
  task,
}: {
  task: ModelTestGenerationTask;
}) {
  return (
    <div className="generation-result-pending">
      <LoadingState
        variant="inline"
        label={
          task.result_available ? "正在加载结果" : statusLabel[task.status]
        }
      />
      <span>任务会在后台继续执行，刷新页面也不会丢失。</span>
    </div>
  );
}
