import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Folder, Music2, Search, Upload, X } from "lucide-react";
import { getFiles, getFolders } from "@features/files";
import { getGalgameProjectAssets } from "@features/galgame-workshop/api";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

export type StoryAudioPickerSource = "project" | "library";

export function StoryAudioPicker({
  projectId,
  title,
  source,
  usedFileIds,
  onSource,
  onChoose,
  onUpload,
  onClose,
}: {
  projectId: string;
  title: string;
  source: StoryAudioPickerSource;
  usedFileIds: Set<string>;
  onSource: (source: StoryAudioPickerSource) => void;
  onChoose: (fileId: string, name: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string>();
  const projectQuery = useQuery({
    queryKey: ["galgame-project-assets", projectId, query],
    queryFn: () => getGalgameProjectAssets(projectId, query),
    enabled: source === "project",
  });
  const libraryQuery = useQuery({
    queryKey: ["managed-files", "library", folderId ?? "root", query, "audio"],
    queryFn: () =>
      getFiles({
        folderId,
        query,
        mediaKind: "audio",
        sort: "updated",
        includeReferences: false,
      }),
    enabled: source === "library",
  });
  const foldersQuery = useQuery({
    queryKey: ["managed-folders", "library"],
    queryFn: () => getFolders(),
    enabled: source === "library",
  });
  const projectAssets = (projectQuery.data?.items ?? []).filter(
    (asset) => asset.media_kind === "audio",
  );
  const libraryAssets = (libraryQuery.data?.items ?? []).filter(
    (asset) => asset.media_kind === "audio" && asset.source === "library",
  );
  const folders = foldersQuery.data?.items ?? [];
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const visibleFolders = folders.filter(
    (folder) =>
      (folderId ? folder.parent_id === folderId : folder.parent_id === null) &&
      (!query ||
        folder.name
          .toLocaleLowerCase("zh-CN")
          .includes(query.toLocaleLowerCase("zh-CN"))),
  );
  const assets = source === "project" ? projectAssets : libraryAssets;
  const loading =
    source === "project" ? projectQuery.isLoading : libraryQuery.isLoading;
  const error = source === "project" ? projectQuery.error : libraryQuery.error;

  return (
    <div className="galgame-asset-picker-backdrop" role="presentation">
      <section
        className="galgame-asset-picker galgame-audio-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <strong>{title}</strong>
            <span>选择工程声音或复用全局文件库中的音频。</span>
          </div>
          <button type="button" aria-label="关闭声音选择器" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <nav aria-label="声音来源">
          <button
            type="button"
            className={source === "project" ? "active" : ""}
            onClick={() => onSource("project")}
          >
            工程声音
          </button>
          <button
            type="button"
            className={source === "library" ? "active" : ""}
            onClick={() => onSource("library")}
          >
            全局文件库
          </button>
        </nav>
        <div className="galgame-asset-picker-toolbar">
          <label>
            <Search aria-hidden />
            <input
              aria-label="搜索声音"
              value={query}
              placeholder="搜索声音…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {source === "library" && currentFolder ? (
            <button
              type="button"
              onClick={() => setFolderId(currentFolder.parent_id ?? undefined)}
            >
              <ArrowLeft aria-hidden /> 返回上层
            </button>
          ) : null}
          <button type="button" onClick={onUpload}>
            <Upload aria-hidden /> 上传声音
          </button>
        </div>
        {error ? (
          <p className="galgame-asset-picker-error">
            {error instanceof Error ? error.message : "声音读取失败"}
          </p>
        ) : null}
        <div className="galgame-asset-picker-grid galgame-audio-picker-grid">
          {loading ? <span>正在读取声音…</span> : null}
          {source === "library"
            ? visibleFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="galgame-asset-picker-folder"
                  onClick={() => setFolderId(folder.id)}
                >
                  <span>
                    <Folder aria-hidden />
                  </span>
                  <strong>{folder.name}</strong>
                  <small>打开文件夹</small>
                </button>
              ))
            : null}
          {assets.map((asset) => (
            <article key={asset.id} className="galgame-audio-picker-choice">
              <StoryAudioPreview
                fileId={asset.id}
                label={asset.display_name}
                compact
              />
              <button
                type="button"
                aria-label={`选择声音 ${asset.display_name}`}
                onClick={() => onChoose(asset.id, asset.display_name)}
              >
                {usedFileIds.has(asset.id) ? "已在故事中使用" : "选择"}
              </button>
            </article>
          ))}
          {!loading && !assets.length && !visibleFolders.length ? (
            <div className="galgame-asset-picker-empty">
              <Music2 aria-hidden />
              <strong>没有可用声音</strong>
              <span>支持 MP3、WAV、M4A 和 OGG。</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
