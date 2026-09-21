import { useEffect, useRef, useState } from "react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { Choice, Numeric } from "./Controls";
import type { CharacterDocument } from "./types";
import type { Crop } from "./exportSettings";
import type { paths } from "@generated/api";
type PreviewQuery = NonNullable<
  paths["/v1/live2d-workshop/projects/{project_id}/preview"]["get"]["parameters"]["query"]
>;
function previewUrl(projectId: string, query: PreviewQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value != null) params.set(key, String(value));
  return `/v1/live2d-workshop/projects/${encodeURIComponent(projectId)}/preview?${params}`;
}
export function ExportPreview({
  projectId,
  doc,
  revision,
  expression,
  motion,
  frame,
  fps,
  width,
  height,
  crop,
  custom,
  onCrop,
  onFrame,
  onExpression,
  onMotion,
  start,
  end,
}: {
  projectId: string;
  doc: CharacterDocument;
  revision: number | null;
  expression: string;
  motion: string;
  frame: number;
  fps: number;
  width: number;
  height: number;
  crop: Crop;
  custom: boolean;
  onCrop: (crop: Crop) => void;
  onFrame: (frame: number) => void;
  onExpression: (id: string) => void;
  onMotion: (id: string) => void;
  start: number;
  end: number;
}) {
  const motionFps = doc.motions.find((m) => m.id === motion)?.fps ?? fps;
  const query: PreviewQuery = {
    expectedRevision: revision ?? 0,
    frame: (frame / fps) * motionFps,
    expressionId: expression || undefined,
    motionId: motion || undefined,
  };
  const full = useApiBlobUrl(
    revision === null ? null : previewUrl(projectId, query),
  );
  const resultPath =
    revision === null
      ? null
      : previewUrl(projectId, {
          ...query,
          width,
          height,
          cropX: crop.x,
          cropY: crop.y,
          cropWidth: crop.width,
          cropHeight: crop.height,
        });
  const [debouncedPath, setDebouncedPath] = useState(resultPath);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPath(resultPath), 180);
    return () => clearTimeout(timer);
  }, [resultPath]);
  const result = useApiBlobUrl(revision === null ? null : debouncedPath);
  const gesture = useRef<{
    x: number;
    y: number;
    crop: Crop;
    resize: boolean;
  } | null>(null);
  return (
    <article className="l2-export-preview">
      <h3>
        实际输出预览 {revision !== null && <small>· revision {revision}</small>}
      </h3>
      <div className="l2-two">
        <Choice
          label="预览表情"
          value={expression}
          options={[
            { value: "", label: "默认" },
            ...doc.expressions.map((e) => ({ value: e.id, label: e.name })),
          ]}
          onChange={onExpression}
        />
        <Choice
          label="预览动作"
          value={motion}
          options={[
            { value: "", label: "静态" },
            ...doc.motions.map((m) => ({ value: m.id, label: m.name })),
          ]}
          onChange={onMotion}
        />
      </div>
      <Numeric
        label="预览帧"
        value={frame}
        min={start}
        max={end - 1}
        onChange={(v) => onFrame(Math.round(v))}
      />
      {revision === null ? (
        <p>当前修改尚未保存，请保存并更新预览。</p>
      ) : (
        <>
          <div
            className="l2-crop-canvas"
            style={{ aspectRatio: `${doc.width}/${doc.height}` }}
          >
            {full.url && <img src={full.url} alt="完整角色与裁切区域" />}
            <svg
              viewBox={`0 0 ${doc.width} ${doc.height}`}
              aria-label="裁切区域"
              onPointerMove={(e) => {
                const g = gesture.current;
                if (!g) return;
                const bounds = e.currentTarget.getBoundingClientRect();
                const dx = ((e.clientX - g.x) / bounds.width) * doc.width,
                  dy = ((e.clientY - g.y) / bounds.height) * doc.height;
                onCrop(
                  g.resize
                    ? {
                        ...g.crop,
                        width: Math.max(
                          1,
                          Math.min(doc.width - g.crop.x, g.crop.width + dx),
                        ),
                        height: Math.max(
                          1,
                          Math.min(doc.height - g.crop.y, g.crop.height + dy),
                        ),
                      }
                    : {
                        ...g.crop,
                        x: Math.max(
                          0,
                          Math.min(doc.width - g.crop.width, g.crop.x + dx),
                        ),
                        y: Math.max(
                          0,
                          Math.min(doc.height - g.crop.height, g.crop.y + dy),
                        ),
                      },
                );
              }}
              onPointerUp={(e) => {
                gesture.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                gesture.current = null;
              }}
            >
              <rect
                x={crop.x}
                y={crop.y}
                width={crop.width}
                height={crop.height}
                fill="#a68aff18"
                stroke="#bca6ff"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(e) => {
                  if (!custom) return;
                  gesture.current = {
                    x: e.clientX,
                    y: e.clientY,
                    crop,
                    resize: false,
                  };
                  e.currentTarget.ownerSVGElement?.setPointerCapture(
                    e.pointerId,
                  );
                }}
              />
              {custom && (
                <rect
                  x={crop.x + crop.width - doc.width / 30}
                  y={crop.y + crop.height - doc.width / 30}
                  width={doc.width / 30}
                  height={doc.width / 30}
                  fill="#bca6ff"
                  onPointerDown={(e) => {
                    gesture.current = {
                      x: e.clientX,
                      y: e.clientY,
                      crop,
                      resize: true,
                    };
                    e.currentTarget.ownerSVGElement?.setPointerCapture(
                      e.pointerId,
                    );
                  }}
                />
              )}
            </svg>
          </div>
          {custom && (
            <p className="l2-hint">
              拖动裁切框移动，拖动右下角调整大小；也可通过数值精确调整。
            </p>
          )}
          {result.url && (
            <img
              className="l2-output-preview"
              src={result.url}
              alt="PNG 实际输出预览"
            />
          )}
          {(full.loading || result.loading) && (
            <p role="status">正在渲染预览…</p>
          )}
          {(full.error || result.error) && (
            <p role="alert">
              {(full.error || result.error)?.message}
              。请重新读取保存版本后再预览。
            </p>
          )}
        </>
      )}
    </article>
  );
}
