import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAccountId } from "@platform/auth/AccountAccess";
import { fetchApiBlob } from "@platform/api/client";
import type { components } from "@generated/api";
import { PreviewQueue } from "./previewQueue";
import "./project-preview.css";

export type ProjectPreview = components["schemas"]["ProjectPreview"];
export type PreviewRenderer = (signal: AbortSignal) => Promise<Blob>;
const queues = new WeakMap<
  QueryClient,
  { media: PreviewQueue; render: PreviewQueue }
>();

function queueFor(client: QueryClient, heavy: boolean) {
  let queue = queues.get(client);
  if (!queue) {
    queue = { media: new PreviewQueue(4), render: new PreviewQueue(1) };
    queues.set(client, queue);
  }
  return heavy ? queue.render : queue.media;
}

async function loadImage(preview: ProjectPreview, signal: AbortSignal) {
  for (const path of preview.urls ?? []) {
    signal.throwIfAborted();
    try {
      const blob = await fetchApiBlob(path, { signal });
      if (!blob.type.startsWith("image/")) continue;
      return blob;
    } catch (error) {
      signal.throwIfAborted();
      if (path === preview.urls?.at(-1)) throw error;
    }
  }
  throw new Error("暂无可用预览");
}

function BlobImage({ blob, title }: { blob: Blob; title: string }) {
  const [source, setSource] = useState<{ blob: Blob; url: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSource({ blob, url });
    setFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return source?.blob === blob && !failed ? (
    <img
      src={source.url}
      alt={`${title}的项目预览`}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="project-cover-placeholder">预览暂不可用</span>
  );
}

export function ProjectCoverPreview({
  projectId,
  namespace = "",
  title,
  preview,
  render,
}: {
  projectId: string;
  namespace?: string;
  title: string;
  preview?: ProjectPreview | null;
  render?: PreviewRenderer;
}) {
  const client = useQueryClient();
  const owner = useAccountId();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    if (!globalThis.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "160px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const needsImage = preview?.kind === "image" || preview?.kind === "scene";
  const image = useQuery({
    queryKey: [
      "project-card-preview",
      owner,
      namespace,
      projectId,
      preview?.version,
    ],
    enabled: visible && !!owner && !!preview && needsImage,
    queryFn: ({ signal }) =>
      queueFor(
        client,
        !!render ||
          !!preview?.urls?.some((url) => url.includes("/preview/frame")),
      ).run(signal, async () => {
        if (render) {
          try {
            return await render(signal);
          } catch {
            signal.throwIfAborted();
          }
        }
        return loadImage(preview!, signal);
      }),
    staleTime: 60_000,
    gcTime: 120_000,
    retry: false,
  });
  useEffect(() => {
    if (!image.data) return;
    const cached = client
      .getQueryCache()
      .findAll({ queryKey: ["project-card-preview"] });
    const unused = cached
      .filter((query) => !query.getObserversCount())
      .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
    for (const query of unused.slice(0, Math.max(0, cached.length - 64))) {
      client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }, [client, image.data]);
  const hasContent = !!preview && preview.kind !== "empty";
  return (
    <span
      ref={host}
      className="project-cover-preview"
      data-kind={preview?.kind ?? "empty"}
      data-ready={!!image.data || (!needsImage && hasContent)}
      aria-busy={visible && needsImage && image.isPending}
    >
      {image.data ? (
        <BlobImage blob={image.data} title={title} />
      ) : preview?.kind === "waveform" ? (
        <span className="project-cover-waveform">
          <svg
            viewBox="0 0 384 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title}的音频波形`}
          >
            {(preview.peaks ?? []).map((peak, index, peaks) => (
              <rect
                key={index}
                x={(index * 384) / peaks.length}
                y={50 - Math.abs(peak) * 46}
                width={Math.max(1, 384 / peaks.length - 1.5)}
                height={Math.max(1, Math.abs(peak) * 92)}
                rx="1"
              />
            ))}
          </svg>
          <strong>{preview.label}</strong>
          <span>{preview.text || "音频标注"}</span>
        </span>
      ) : preview?.kind === "table" ? (
        <span className="project-cover-sheet">
          <strong>{preview.label}</strong>
          <table aria-label={`${title}的工作表预览`}>
            <tbody>
              {(preview.cells ?? []).map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td
                      key={column}
                      style={{
                        color: cell.color ?? undefined,
                        background: cell.background ?? undefined,
                        fontWeight: cell.bold ? 700 : 400,
                      }}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </span>
      ) : hasContent && (preview.text || preview.label) ? (
        <span className="project-cover-excerpt">
          <strong>{preview.label || title}</strong>
          <span>{preview.text}</span>
        </span>
      ) : (
        <span className="project-cover-placeholder">
          <span>
            {visible && needsImage && image.isPending
              ? "正在读取预览…"
              : "暂无内容预览"}
          </span>
        </span>
      )}
    </span>
  );
}
