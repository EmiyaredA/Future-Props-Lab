import { useState } from "react";
import { FileImage, Plus, Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath, type VisualCanvasNode } from "../api";

export function AcceptanceThumbnail({
  assetId,
  kind,
  alt = "参考素材",
}: {
  assetId: string;
  kind?: string;
  alt?: string;
}) {
  const blob = useApiBlobUrl(visualAssetDownloadPath(assetId));
  const [broken, setBroken] = useState("");
  const [videoFallback, setVideoFallback] = useState("");
  return (
    <span className="acceptance-thumbnail">
      {blob.url && broken !== blob.url ? (
        kind === "video" || videoFallback === blob.url ? (
          <video
            src={blob.url}
            muted
            preload="metadata"
            aria-label={alt}
            onError={() => setBroken(blob.url)}
          />
        ) : (
          <img
            src={blob.url}
            alt={alt}
            onError={() =>
              kind ? setBroken(blob.url) : setVideoFallback(blob.url)
            }
          />
        )
      ) : (
        <span>
          <FileImage size={18} />
          <small>
            {blob.error ? "不可读取" : broken ? "无预览" : "加载中"}
          </small>
        </span>
      )}
    </span>
  );
}

export function ReferenceMaterials({
  ids,
  nodes,
  onChange,
  disabled,
}: {
  ids: string[];
  nodes: VisualCanvasNode[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [picking, setPicking] = useState<number | "add">();
  const choices = nodes.filter(
    (node) => (node.kind === "image" || node.kind === "video") && node.asset_id,
  );
  const unique = choices.filter(
    (node, index) =>
      choices.findIndex(
        (candidate) =>
          candidate.kind !== "text" &&
          node.kind !== "text" &&
          candidate.asset_id === node.asset_id,
      ) === index,
  );
  return (
    <section
      className="acceptance-reference-field"
      aria-label="绑定项目参考素材"
    >
      <div className="acceptance-list-heading">
        <strong>参考依据</strong>
        <button
          type="button"
          disabled={disabled || ids.length >= 6 || !unique.length}
          onClick={() => setPicking("add")}
        >
          <Plus size={14} />
          选择参考
        </button>
      </div>
      <div className="acceptance-reference-list">
        {ids.map((id, index) => {
          const node = unique.find(
            (node) => node.kind !== "text" && node.asset_id === id,
          );
          return (
            <div className="acceptance-reference-row" key={id}>
              <AcceptanceThumbnail assetId={id} kind={node?.kind} />
              <div>
                <strong>{node?.title || `参考素材 ${id.slice(0, 8)}`}</strong>
                <small>
                  {node?.kind !== "text" && node?.final_version
                    ? `输出 v${node.final_version} · 固定素材`
                    : "固定素材"}
                </small>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPicking(index)}
                aria-label={`替换参考 ${index + 1}`}
              >
                替换
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={`解除参考 ${index + 1}`}
                onClick={() => onChange(ids.filter((value) => value !== id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {!ids.length && (
        <p className="acceptance-muted">
          尚未绑定参考。选择当前项目的图片或视频。
        </p>
      )}
      {picking !== undefined && (
        <div className="acceptance-reference-picker">
          <CustomSelect
            ariaLabel="选择项目参考素材"
            value=""
            disabled={disabled}
            options={[
              { value: "", label: "选择图片或视频…" },
              ...unique.map((node) => ({
                value: node.kind !== "text" ? node.asset_id! : "",
                label: node.title,
                disabled: node.kind !== "text" && ids.includes(node.asset_id!),
              })),
            ]}
            onChange={(id) => {
              if (!id || ids.includes(id)) return;
              onChange(
                picking === "add"
                  ? [...ids, id]
                  : ids.map((value, index) => (index === picking ? id : value)),
              );
              setPicking(undefined);
            }}
          />
          <button type="button" onClick={() => setPicking(undefined)}>
            取消
          </button>
        </div>
      )}
      <small>固定绑定当前素材，发布后保留参考快照。</small>
    </section>
  );
}
