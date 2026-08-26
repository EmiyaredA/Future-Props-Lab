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
  const uniqueFileCount = new Set(fileIds).size;
  const [frameIndex, setFrameIndex] = useState(0);
  const [readyGroup, setReadyGroup] = useState<{
    key: string;
    urls: Map<string, string>;
    failedFileIds: Set<string>;
    settledFileIds: Set<string>;
  }>();
  const [lastReadyFrame, setLastReadyFrame] = useState<{
    key: string;
    fileId: string;
    url: string;
  }>();
  const retainedUrlsRef = useRef(new Set<string>());
  const reportedNaturalSizeKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    setFrameIndex(0);
    reportedNaturalSizeKey.current = undefined;
  }, [sequenceKey]);

  useEffect(() => {
    if (!sequence) {
      setReadyGroup(undefined);
      return;
    }
    let active = true;
    setReadyGroup({
      key: sequenceKey,
      urls: new Map(),
      failedFileIds: new Set(),
      settledFileIds: new Set(),
    });
    for (const fileId of new Set(fileIds)) {
      void fetchApiBlob(`/v1/files/${fileId}/content`)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(url);
            return;
          }
          retainedUrlsRef.current.add(url);
          setReadyGroup((current) => {
            if (current?.key !== sequenceKey) return current;
            const urls = new Map(current.urls);
            urls.set(fileId, url);
            const settledFileIds = new Set(current.settledFileIds);
            settledFileIds.add(fileId);
            return { ...current, urls, settledFileIds };
          });
        })
        .catch(() => {
          if (!active) return;
          setReadyGroup((current) => {
            if (current?.key !== sequenceKey) return current;
            const failedFileIds = new Set(current.failedFileIds);
            failedFileIds.add(fileId);
            const settledFileIds = new Set(current.settledFileIds);
            settledFileIds.add(fileId);
            return { ...current, failedFileIds, settledFileIds };
          });
        });
    }
    return () => {
      active = false;
    };
  }, [fileIds, sequence, sequenceKey]);

  useEffect(
    () => () => {
      for (const url of retainedUrlsRef.current) URL.revokeObjectURL(url);
      retainedUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (
      !sequence ||
      readyGroup?.key !== sequenceKey ||
      readyGroup.settledFileIds.size < uniqueFileCount ||
      controlledFrameIndex !== undefined
    )
      return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current < fileIds.length - 1) return current + 1;
        return sequence.loop ? 0 : current;
      });
    }, 1000 / sequence.fps);
    return () => window.clearInterval(timer);
  }, [
    controlledFrameIndex,
    fileIds.length,
    readyGroup?.key,
    readyGroup?.settledFileIds.size,
    sequence,
    sequenceKey,
    uniqueFileCount,
  ]);

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
  const currentGroup = readyGroup?.key === sequenceKey ? readyGroup : undefined;
  const firstSuccessfulFileId = fileIds.find(
    (fileId) =>
      currentGroup?.urls.get(fileId) && !currentGroup.failedFileIds.has(fileId),
  );
  const displayFileId = currentGroup
    ? currentGroup.urls.has(candidateFileId) &&
      !currentGroup.failedFileIds.has(candidateFileId)
      ? candidateFileId
      : firstSuccessfulFileId
    : lastReadyFrame?.fileId;
  const displayUrl = currentGroup
    ? displayFileId
      ? currentGroup.urls.get(displayFileId)
      : undefined
    : lastReadyFrame?.url;
  const reportAnchorNaturalSize = (fileId: string, image: HTMLImageElement) => {
    const anchorFailed = currentGroup?.failedFileIds.has(fileIds[0]) ?? false;
    if (fileId !== fileIds[0] && !anchorFailed) return;
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
      {[...(currentGroup?.urls.entries() ?? [])].map(([fileId, url]) =>
        url ? (
          <img
            key={`preload-${fileId}`}
            src={url}
            alt=""
            aria-hidden
            className="galgame-expression-frame-preload"
            data-file-id={fileId}
            onLoad={(event) => {
              reportAnchorNaturalSize(fileId, event.currentTarget);
            }}
            onError={() =>
              setReadyGroup((current) =>
                current?.key === sequenceKey
                  ? {
                      ...current,
                      failedFileIds: new Set(current.failedFileIds).add(fileId),
                    }
                  : current,
              )
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
            setLastReadyFrame({
              key: sequenceKey,
              fileId: readyDisplay.fileId,
              url: readyDisplay.url,
            });
            reportAnchorNaturalSize(readyDisplay.fileId, event.currentTarget);
          }}
          onError={() =>
            setReadyGroup((current) =>
              current?.key === sequenceKey
                ? {
                    ...current,
                    failedFileIds: new Set(current.failedFileIds).add(
                      readyDisplay.fileId,
                    ),
                  }
                : current,
            )
          }
        />
      ) : (
        fallback
      )}
    </>
  );
}
