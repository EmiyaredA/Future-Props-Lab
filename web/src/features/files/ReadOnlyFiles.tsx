import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { FileThumbnail } from "./FileThumbnail";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { getFiles, getFolders, type ManagedFile, type MediaKind } from "./api";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { fileQueryKeys } from "./queryKeys";
export function ReadOnlyFiles({
  projectId,
  initialKind,
}: {
  projectId?: string;
  initialKind?: string;
}) {
  const [mediaKind, setMediaKind] = useState<MediaKind | undefined>(() =>
    ["image", "video", "audio", "document"].includes(initialKind ?? "")
      ? (initialKind as MediaKind)
      : undefined,
  );
  const [folderId, setFolderId] = useState<string>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ManagedFile | null>(null);
  const options = {
    projectId,
    folderId,
    query,
    mediaKind,
    includeReferences: true,
  };
  const files = useQuery({
    queryKey: fileQueryKeys.list(options),
    queryFn: () => getFiles(options),
  });
  const folders = useQuery({
    queryKey: fileQueryKeys.folders(projectId),
    queryFn: () => getFolders(projectId),
  });
  return (
    <ReadOnlyPage
      title={projectId ? "项目素材" : "文件管理"}
      loading={files.isPending}
      error={files.error || folders.error}
    >
      <input
        className="readonly-search"
        aria-label="搜索素材"
        placeholder="搜索素材名称"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <CustomSelect
        ariaLabel="文件类型"
        value={mediaKind ?? "all"}
        onChange={(value) => {
          setMediaKind(value === "all" ? undefined : (value as MediaKind));
          setSelected(null);
        }}
        options={[
          { value: "all", label: "全部类型" },
          { value: "image", label: "图片" },
          { value: "video", label: "视频" },
          { value: "audio", label: "音频" },
          { value: "document", label: "文档" },
        ]}
      />
      <div className="button-row">
        <button
          className="btn"
          onClick={() => {
            setFolderId(undefined);
            setSelected(null);
          }}
        >
          根目录
        </button>
        {folders.data?.items
          .filter((f) => (f.parent_id || undefined) === folderId)
          .map((f) => (
            <button
              className="btn"
              key={f.id}
              onClick={() => {
                setFolderId(f.id);
                setSelected(null);
              }}
            >
              {f.name}
            </button>
          ))}
      </div>
      <div className="readonly-collection">
        {files.data?.items.map((f) => (
          <button
            className="readonly-card"
            key={f.reference_id || f.id}
            onClick={() => setSelected(f)}
          >
            <span className="readonly-file-thumbnail">
              <FileThumbnail file={f} />
            </span>
            <strong>{f.display_name || f.original_filename}</strong>
            <small>
              {f.media_kind} · {(f.byte_size / 1024).toFixed(0)} KB
            </small>
          </button>
        ))}
      </div>
      {files.data?.items.length === 0 ? <p>当前目录暂无素材。</p> : null}
      {selected ? (
        <FilePreviewDialog file={selected} onClose={() => setSelected(null)} />
      ) : null}
    </ReadOnlyPage>
  );
}
