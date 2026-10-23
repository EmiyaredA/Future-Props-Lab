import { useEffect, useId, useRef, useState } from "react";
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
  const pickerId = useId();
  const picker = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
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
  useEffect(() => {
    if (picking !== undefined) picker.current?.focus();
  }, [picking]);

  const closePicker = () => {
    setPicking(undefined);
    opener.current?.focus();
  };
  const openPicker = (value: number | "add", trigger: HTMLButtonElement) => {
    opener.current = trigger;
    setPicking(value);
  };

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
          aria-expanded={!disabled && picking === "add"}
          aria-controls={pickerId}
          onClick={(event) => openPicker("add", event.currentTarget)}
        >
          <Plus size={14} />
          选择参考
        </button>
      </div>
      <ul className="acceptance-reference-list" aria-label="已绑定参考">
        {ids.map((id, index) => {
          const node = unique.find(
            (node) => node.kind !== "text" && node.asset_id === id,
          );
          return (
            <ReferenceMaterialRow
              key={id}
              assetId={id}
              kind={node?.kind}
              title={node?.title || `参考素材 ${id.slice(0, 8)}`}
              description={
                node?.kind !== "text" && node?.final_version
                  ? `输出 v${node.final_version} · 固定素材`
                  : "固定素材"
              }
            >
              <button
                type="button"
                disabled={disabled || !unique.length}
                aria-expanded={!disabled && picking === index}
                aria-controls={pickerId}
                onClick={(event) => openPicker(index, event.currentTarget)}
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
        <div
          className="acceptance-reference-picker"
          ref={picker}
          id={pickerId}
          role="region"
          aria-label="选择项目参考素材"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              closePicker();
            }
          }}
        >
          <div className="acceptance-list-heading">
            <strong>选择图片或视频</strong>
            <button type="button" onClick={closePicker}>
              取消
            </button>
          </div>
          <ul
            className="acceptance-reference-options"
            aria-label="项目参考素材"
          >
            {unique.map(
              (node) =>
                node.kind !== "text" &&
                node.asset_id && (
                  <ReferenceMaterialRow
                    key={node.asset_id}
                    assetId={node.asset_id}
                    kind={node.kind}
                    title={node.title}
                    description=""
                    status={ids.includes(node.asset_id) ? "已绑定" : undefined}
                    selection={{
                      label: `绑定 ${node.title}`,
                      disabled: ids.includes(node.asset_id),
                      onSelect: () => {
                        const id = node.asset_id!;
                        if (
                          disabled ||
                          ids.includes(id) ||
                          (picking === "add" && ids.length >= 6)
                        )
                          return;
                        onChange(
                          picking === "add"
                            ? [...ids, id]
                            : ids.map((value, index) =>
                                index === picking ? id : value,
                              ),
                        );
                        closePicker();
                      },
                    }}
                  />
                ),
            )}
          </ul>
        </div>
      )}
      <small>固定绑定当前素材，发布后保留参考快照。</small>
    </section>
  );
}
