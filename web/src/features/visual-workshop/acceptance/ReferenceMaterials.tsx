import { useState } from "react";
import { SearchablePickerDialog } from "@shared/ui/SearchablePickerDialog";
import { Plus, Trash2 } from "lucide-react";
import type { VisualCanvasNode } from "../api";
import { ReferenceMaterialRow } from "./ReferenceMaterialRow";

export { AcceptanceThumbnail } from "./ReferenceMaterialRow";

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
  const unique = new Map<
    string,
    {
      id: string;
      title: string;
      kind: "image" | "video";
      final_version?: number | null;
    }
  >();
  for (const node of nodes) {
    if (
      (node.kind === "image" || node.kind === "video") &&
      node.asset_id &&
      !unique.has(node.asset_id)
    )
      unique.set(node.asset_id, {
        id: node.asset_id,
        title: node.title,
        kind: node.kind,
        final_version: node.final_version,
      });
  }

  return (
    <section
      className="acceptance-reference-field"
      aria-label="绑定项目参考素材"
    >
      <div className="acceptance-list-heading">
        <strong>参考依据</strong>
        <button
          type="button"
          disabled={disabled || ids.length >= 6 || !unique.size}
          aria-haspopup="dialog"
          onClick={() => setPicking("add")}
        >
          <Plus size={14} />
          选择参考
        </button>
      </div>
      <ul className="acceptance-reference-list" aria-label="已绑定参考">
        {ids.map((id, index) => {
          const node = unique.get(id);
          return (
            <ReferenceMaterialRow
              key={id}
              assetId={id}
              kind={node?.kind}
              title={node?.title || `参考素材 ${id.slice(0, 8)}`}
              description={
                node?.final_version
                  ? `输出 v${node.final_version} · 固定素材`
                  : "固定素材"
              }
            >
              <button
                type="button"
                disabled={disabled || !unique.size}
                aria-haspopup="dialog"
                onClick={() => setPicking(index)}
                aria-label={`替换参考 ${index + 1}`}
              >
                替换
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={`解除参考 ${index + 1}`}
                onClick={() => {
                  onChange(ids.filter((value) => value !== id));
                }}
              >
                <Trash2 size={14} />
              </button>
            </ReferenceMaterialRow>
          );
        })}
      </ul>
      {!ids.length && (
        <p className="acceptance-muted">
          尚未绑定参考。选择当前项目的图片或视频。
        </p>
      )}
      {picking !== undefined && !disabled && (
        <SearchablePickerDialog
          title="选择项目参考素材"
          searchLabel="搜索图片或视频"
          items={[...unique.values()].map(({ id, kind, title }) => ({
            id,
            label: title,
            icon: kind,
            disabled: ids.includes(id),
          }))}
          renderChoice={(item, control) => (
            <ReferenceMaterialRow
              key={item.id}
              assetId={item.id}
              kind={item.icon}
              title={item.label}
              description=""
              status={item.disabled ? "已绑定" : undefined}
              selection={{ label: `绑定 ${item.label}`, ...control }}
            />
          )}
          onClose={() => setPicking(undefined)}
          onChoose={(item) => {
            if (
              !item ||
              disabled ||
              ids.includes(item.id) ||
              !unique.has(item.id) ||
              (picking === "add" && ids.length >= 6)
            )
              return;
            onChange(
              picking === "add"
                ? [...ids, item.id]
                : ids.map((value, index) =>
                    index === picking ? item.id : value,
                  ),
            );
          }}
        />
      )}
      <small>固定绑定当前素材，发布后保留参考快照。</small>
    </section>
  );
}
