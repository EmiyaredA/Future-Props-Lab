import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { fetchApiBlob } from "@platform/api/client";
import type {
  GalgameStoryAsset,
  GalgameStoryCharacterExpression,
} from "@features/galgame-workshop/api";
import type { PortraitNaturalSize } from "@features/galgame-workshop/editor/portraitSizing";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";

function expressionFileIds(
  expression: GalgameStoryCharacterExpression | undefined,
  assets: GalgameStoryAsset[],
  skinAssetId?: string,
) {
  const assetIds = skinAssetId
    ? [skinAssetId]
    : expression?.renderMode === "frameSequence" && expression.sequence
      ? expression.sequence.frames.map((frame) => frame.assetId)
      : expression
        ? [expression.assetId]
        : [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return assetIds.flatMap((assetId) => {
    const asset = assetsById.get(assetId);
    return asset?.type === "image" ? [asset.fileId] : [];
  });
}

export function ExpressionPortrait({
  expression,
  assets,
  skinAssetId,
  alt,
  fallback,
  className,
  style,
  onNaturalSize,
  controlledFrameIndex,
}: {
  expression?: GalgameStoryCharacterExpression;
  assets: GalgameStoryAsset[];
  skinAssetId?: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  onNaturalSize?: (size: PortraitNaturalSize) => void;
  controlledFrameIndex?: number;
}) {
  const fileIds = useMemo(
    () => expressionFileIds(expression, assets, skinAssetId),
    [assets, expression, skinAssetId],
  );
  const sequence =
    !skinAssetId &&
    expression?.renderMode === "frameSequence" &&
    expression.sequence &&
    fileIds.length > 1
      ? expression.sequence
      : undefined;
  const sequenceKey = `${expression?.id ?? "missing"}:${skinAssetId ?? "base"}:${fileIds.join(",")}:${sequence?.fps ?? 0}:${sequence?.loop ?? false}`;
  const [frameIndex, setFrameIndex] = useState(0);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [failedFileIds, setFailedFileIds] = useState<Set<string>>(new Set());
  const [lastReadyFileId, setLastReadyFileId] = useState<string>();
  const reportedNaturalSizeKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    setFrameIndex(0);
    setFailedFileIds(new Set());
    setLastReadyFileId(undefined);
    reportedNaturalSizeKey.current = undefined;
  }, [sequenceKey]);

  useEffect(() => {
    if (!sequence) {
      setUrls(new Map());
      return;
    }
    let active = true;
    const objectUrls: string[] = [];
    void Promise.all(
      [...new Set(fileIds)].map(async (fileId) => {
        try {
          const blob = await fetchApiBlob(`/v1/files/${fileId}/content`);
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          return [fileId, url] as const;
        } catch {
          return [fileId, ""] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setUrls(new Map(entries));
      setFailedFileIds(
        new Set(entries.flatMap(([fileId, url]) => (url ? [] : [fileId]))),
      );
    });
    return () => {
      active = false;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [fileIds, sequence]);

  useEffect(() => {
    if (!sequence || urls.size === 0 || controlledFrameIndex !== undefined)
      return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current < fileIds.length - 1) return current + 1;
        return sequence.loop ? 0 : current;
      });
    }, 1000 / sequence.fps);
    return () => window.clearInterval(timer);
  }, [controlledFrameIndex, fileIds.length, sequence, urls.size]);

  if (!sequence) {
    return (
      <StoryAssetImage
        fileId={fileIds[0]}
        alt={alt}
        fallback={fallback}
        className={className}
        style={style}
        onNaturalSize={onNaturalSize}
      />
    );
  }

  const resolvedFrameIndex =
    controlledFrameIndex === undefined
      ? frameIndex
      : Math.max(0, Math.min(fileIds.length - 1, controlledFrameIndex));
  const candidateFileId = fileIds[resolvedFrameIndex];
  const displayFileId = failedFileIds.has(candidateFileId)
    ? lastReadyFileId
    : candidateFileId;
  const displayUrl = displayFileId ? urls.get(displayFileId) : undefined;
  const reportAnchorNaturalSize = (fileId: string, image: HTMLImageElement) => {
    if (fileId !== fileIds[0] && !failedFileIds.has(fileIds[0])) return;
    const size = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    if (size.width <= 0 || size.height <= 0) return;
    const reportKey = `${sequenceKey}:${fileId}:${size.width}x${size.height}`;
    if (reportedNaturalSizeKey.current === reportKey) return;
    reportedNaturalSizeKey.current = reportKey;
    onNaturalSize?.(size);
  };
  const readyDisplay =
    displayFileId && displayUrl
      ? { fileId: displayFileId, url: displayUrl }
      : undefined;
  return (
    <>
      {[...urls.entries()].map(([fileId, url]) =>
        url ? (
          <img
            key={`preload-${fileId}`}
            src={url}
            alt=""
            aria-hidden
            className="galgame-expression-frame-preload"
            data-file-id={fileId}
            onLoad={(event) => {
              setLastReadyFileId((current) => current ?? fileId);
              reportAnchorNaturalSize(fileId, event.currentTarget);
            }}
            onError={() =>
              setFailedFileIds((current) => new Set(current).add(fileId))
            }
          />
        ) : null,
      )}
      {readyDisplay ? (
        <img
          src={readyDisplay.url}
          alt={alt}
          className={className}
          style={style}
          data-sequence-frame={resolvedFrameIndex}
          data-file-id={readyDisplay.fileId}
          onLoad={(event) => {
            setLastReadyFileId(readyDisplay.fileId);
            reportAnchorNaturalSize(readyDisplay.fileId, event.currentTarget);
          }}
          onError={() =>
            setFailedFileIds((current) => new Set(current).add(candidateFileId))
          }
        />
      ) : (
        fallback
      )}
    </>
  );
}
