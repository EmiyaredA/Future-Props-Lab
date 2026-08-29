import { useEffect, useRef, useState } from "react";
import { Image, LoaderCircle, Video } from "lucide-react";
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
    void getModelTestGenerationResult(task.id)
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
  }, [task.id, task.result_available, visible]);

  const fallback =
    task.status === "completed" && task.result_available && !failed ? (
      <LoaderCircle className="spinning" aria-hidden />
    ) : task.kind === "image" ? (
      <Image aria-hidden />
    ) : (
      <Video aria-hidden />
    );

  return (
    <div className={`generation-task-thumbnail ${task.kind}`} ref={root}>
      {url && task.kind === "image" ? <img src={url} alt="" /> : null}
      {url && task.kind === "video" ? (
        <video src={url} muted preload="metadata" aria-hidden />
      ) : null}
      {!url ? fallback : null}
    </div>
  );
}
