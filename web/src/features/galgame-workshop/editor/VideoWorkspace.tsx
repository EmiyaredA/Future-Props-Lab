import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, LocateFixed, Upload } from "lucide-react";
import {
  batchUploadGalgameProjectAssets,
  getGalgameAssetOverview,
  getGalgameProjectAssets,
  patchGalgameProjectAsset,
  uploadGalgameProjectAsset,
  type GalgameProjectAsset,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  galgameQueryKeys,
  invalidateGalgameAssetQueries,
} from "@features/galgame-workshop/queryKeys";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { formatFileSize } from "@shared/lib/fileSize";
import { CustomSelect } from "@shared/ui/CustomSelect";

export function VideoWorkspace({
  projectId,
  document,
  onDocument,
  onLocate,
  onNotice,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [decodeFailed, setDecodeFailed] = useState(false);
  const query = useQuery({
    queryKey: galgameQueryKeys.projectAssets(projectId, "video"),
    queryFn: () => getGalgameProjectAssets(projectId),
  });
  const overview = useQuery({
    queryKey: galgameQueryKeys.assetOverview(projectId),
    queryFn: () => getGalgameAssetOverview(projectId),
  });
  const videos = useMemo(
    () =>
      (query.data?.items ?? []).filter((asset) => asset.media_kind === "video"),
    [query.data?.items],
  );
  const selected = videos.find((asset) => asset.id === selectedId) ?? videos[0];
  const details = overview.data?.items.find(
    (asset) => asset.id === selected?.id,
  );

  const { url } = useApiBlobUrl(
    selected ? `/v1/files/${selected.id}/content` : null,
  );

  useEffect(() => setDecodeFailed(false), [selected]);

  const upload = useMutation({
    mutationFn: async (files: File[]) =>
      files.length === 1
        ? {
            items: [
              await uploadGalgameProjectAsset(projectId, files[0], "video"),
            ],
            importItems: [],
          }
        : batchUploadGalgameProjectAssets(projectId, files, "video"),
    onSuccess: (result) => {
      const known = new Set(
        (document.assets ?? []).map((asset) => asset.fileId),
      );
      onDocument({
        ...document,
        assets: [
          ...(document.assets ?? []),
          ...result.items
            .filter((file) => !known.has(file.id))
            .map((file) => ({
              id: stableId(),
              type: "video" as const,
              role: "video" as const,
              label: file.display_name,
              fileId: file.id,
              status: "ready" as const,
            })),
        ],
      });
      setSelectedId(result.items[0]?.id);
      void invalidateGalgameAssetQueries(client, projectId);
      onNotice(`已导入 ${result.items.length} 个视频到 video/。`);
    },
    onError: () => onNotice("视频导入失败，请使用 MP4、WebM 或 MOV。"),
  });
  const patchPolicy = useMutation({
    mutationFn: ({
      asset,
      policy,
    }: {
      asset: GalgameProjectAsset;
      policy: "auto" | "include" | "exclude";
    }) =>
      patchGalgameProjectAsset(projectId, asset, { packagingPolicy: policy }),
    onSuccess: () => {
      void invalidateGalgameAssetQueries(client, projectId);
    },
  });

  return (
    <div className="galgame-video-workspace">
      <header>
        <div>
          <small>VIDEO</small>
          <h2>视频素材</h2>
        </div>
        <button
          type="button"
          aria-label="上传视频"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
        >
          <Upload aria-hidden /> {upload.isPending ? "导入中…" : "批量导入"}
        </button>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mov"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) upload.mutate(files);
          }}
        />
      </header>
      <aside>
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            className={video.id === selected?.id ? "active" : ""}
            onClick={() => setSelectedId(video.id)}
          >
            <Film aria-hidden />
            <span>
              <strong>{video.display_name}</strong>
              <small>{formatFileSize(video.byte_size)}</small>
            </span>
          </button>
        ))}
        {!videos.length ? <p>尚未导入视频素材。</p> : null}
      </aside>
      <main>
        {selected ? (
          <>
            <div className="galgame-video-preview">
              {url ? (
                <video
                  key={url}
                  src={url}
                  controls
                  onError={() => setDecodeFailed(true)}
                />
              ) : (
                <Film aria-hidden />
              )}
            </div>
            {decodeFailed ? (
              <p className="galgame-asset-warning">
                浏览器无法解码此视频。文件已保留，请转码为 H.264 MP4 或 VP9 WebM
                后替换。
              </p>
            ) : null}
            <dl>
              <div>
                <dt>项目路径</dt>
                <dd>{selected.virtualPath}</dd>
              </div>
              <div>
                <dt>大小</dt>
                <dd>{formatFileSize(selected.byte_size)}</dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>
                  {selected.durationMs
                    ? `${(selected.durationMs / 1000).toFixed(2)} 秒`
                    : "等待元数据扫描"}
                </dd>
              </div>
              <div>
                <dt>引用</dt>
                <dd>{details?.reference_count ?? 0} 处</dd>
              </div>
            </dl>
            <label>
              打包策略
              <CustomSelect
                ariaLabel="视频打包策略"
                value={selected.packagingPolicy ?? "auto"}
                onChange={(value) =>
                  patchPolicy.mutate({
                    asset: selected,
                    policy: value as "auto" | "include" | "exclude",
                  })
                }
                options={[
                  { value: "auto", label: "自动（仅有效引用）" },
                  { value: "include", label: "强制打包" },
                  { value: "exclude", label: "强制排除" },
                ]}
              />
            </label>
            <section>
              {(details?.references ?? []).map((reference, index) => (
                <button
                  key={`${reference.kind}-${index}`}
                  type="button"
                  disabled={!reference.fragmentId || !reference.blockId}
                  onClick={() =>
                    reference.fragmentId &&
                    reference.blockId &&
                    onLocate(reference.fragmentId, reference.blockId)
                  }
                >
                  <LocateFixed aria-hidden /> {reference.label}
                </button>
              ))}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
