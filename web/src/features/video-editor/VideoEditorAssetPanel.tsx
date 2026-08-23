import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Image, Library, Music2, Type, Upload, Video } from "lucide-react";
import {
  importVideoEditorAssets,
  listVideoEditorImportSources,
  uploadVideoEditorAsset,
} from "./api";
import type { VideoEditorAsset } from "./types";

const iconFor = (kind: string) =>
  kind === "video" ? Video : kind === "audio" ? Music2 : kind === "image" ? Image : Type;

export function VideoEditorAssetPanel({
  projectId,
  assets,
  onAdd,
  onAddGenerated,
}: {
  projectId: string;
  assets: VideoEditorAsset[];
  onAdd: (asset: VideoEditorAsset) => void;
  onAddGenerated: (kind: "text" | "color") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const sources = useQuery({
    queryKey: ["video-editor-import-sources"],
    queryFn: listVideoEditorImportSources,
    enabled: showImport,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["video-editor-assets", projectId] });
  const upload = useMutation({
    mutationFn: (file: File) => uploadVideoEditorAsset(projectId, file),
    onSuccess: refresh,
  });
  const importAssets = useMutation({
    mutationFn: () => importVideoEditorAssets(projectId, chosen),
    onSuccess: () => {
      setChosen([]);
      setShowImport(false);
      refresh();
    },
  });
  return (
    <aside className="ve-assets-panel">
      <header>
        <strong>素材</strong>
        <span>{assets.length}</span>
      </header>
      <div className="ve-asset-actions">
        <button onClick={() => input.current?.click()}>
          <Upload aria-hidden /> 上传
        </button>
        <button onClick={() => setShowImport(true)}>
          <Library aria-hidden /> 导入快照
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept="video/*,audio/*,image/*,.ttf,.otf,.woff,.woff2"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = "";
          }}
        />
      </div>
      <div className="ve-generated-assets">
        <button onClick={() => onAddGenerated("text")}>
          <Type aria-hidden /> 文字卡
        </button>
        <button onClick={() => onAddGenerated("color")}>
          <span className="ve-black-swatch" /> 纯色黑幕
        </button>
      </div>
      <div className="ve-assets-list">
        {assets.map((asset) => {
          const Icon = iconFor(asset.mediaKind);
          return (
            <button
              key={asset.id}
              className="ve-asset"
              disabled={asset.processingStatus !== "ready"}
              draggable={asset.processingStatus === "ready"}
              onDragStart={(event) =>
                event.dataTransfer.setData("application/x-video-editor-asset", asset.id)
              }
              onDoubleClick={() => onAdd(asset)}
            >
              {asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt="" />
              ) : (
                <span><Icon aria-hidden /></span>
              )}
              <div>
                <strong>{asset.displayName}</strong>
                <small>
                  {asset.processingStatus === "ready" ? asset.mediaKind : asset.processingStatus}
                </small>
              </div>
              <FilePlus2 aria-label="添加到时间轴" />
            </button>
          );
        })}
      </div>
      {showImport ? (
        <div className="ve-dialog-backdrop">
          <section className="ve-dialog ve-import-dialog" role="dialog" aria-modal="true">
            <h2>从其他应用复制素材</h2>
            <p>导入后生成独立物理快照，源项目删除也不会影响剪辑。</p>
            <div>
              {(sources.data?.items ?? []).map((asset) => (
                <button
                  key={asset.id}
                  className={chosen.includes(asset.id) ? "selected" : ""}
                  onClick={() =>
                    setChosen((items) =>
                      items.includes(asset.id)
                        ? items.filter((id) => id !== asset.id)
                        : [...items, asset.id],
                    )
                  }
                >
                  <span>{chosen.includes(asset.id) ? "✓" : ""}</span>
                  <div><strong>{asset.displayName}</strong><small>{asset.sourceApplication}</small></div>
                </button>
              ))}
            </div>
            <footer>
              <button onClick={() => setShowImport(false)}>取消</button>
              <button className="primary" disabled={!chosen.length} onClick={() => importAssets.mutate()}>
                复制 {chosen.length || ""} 项
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
