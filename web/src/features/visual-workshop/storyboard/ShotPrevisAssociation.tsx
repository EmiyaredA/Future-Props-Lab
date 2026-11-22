import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { OutputPreview } from "../board/OutputPreview";
import { listPrevis } from "../previs/api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import type { VisualCanvasNode } from "../api";
import type { Shot } from "./api";

export function ShotPrevisAssociation({
  project,
  shot,
  nodes,
  disabled,
  readOnly,
  onChange,
  onOpen,
  onOutput,
}: {
  project: string;
  shot: Shot;
  nodes: VisualCanvasNode[];
  disabled: boolean;
  readOnly: boolean;
  onChange: (value: Shot["previs"]) => void;
  onOpen?: () => void;
  onOutput: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const scenes = useQuery({
    queryKey: keys.previs(project),
    queryFn: ({ signal }) => listPrevis(project, signal),
    enabled: Boolean(shot.previs) || editing,
  });
  const scene = scenes.data?.find((row) => row.id === shot.previs?.scene_id);
  const outputs = shot.previs
    ? nodes.filter(
        (node) =>
          (node.kind === "image" || node.kind === "video") &&
          node.asset_id &&
          node.tags?.includes("白模预演") &&
          node.tags.includes(
            `${shot.previs!.scene_id}@${shot.previs!.stage_revision}`,
          ),
      )
    : [];
  return (
    <section
      className="storyboard-previs-association"
      aria-label="白模预演输出"
    >
      <header>
        <strong>白模预演输出</strong>
        {!readOnly && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing((value) => !value)}
          >
            {shot.previs ? "更换关联" : "关联白模预演"}
          </button>
        )}
      </header>
      {editing && !readOnly && (
        <CustomSelect
          ariaLabel="关联白模场景"
          disabled={disabled || scenes.isPending || scenes.isError}
          value={shot.previs?.scene_id ?? ""}
          options={[
            { value: "", label: "未关联" },
            ...(scenes.data ?? []).map((row) => ({
              value: row.id,
              label: row.title,
            })),
            ...(shot.previs && !scene
              ? [{ value: shot.previs.scene_id, label: "原场景不可用" }]
              : []),
          ]}
          onChange={(id) => {
            const value = scenes.data?.find((row) => row.id === id);
            if (id === shot.previs?.scene_id) return;
            onChange(
              value
                ? {
                    scene_id: value.id,
                    stage_revision: value.revision,
                    camera_id: null,
                    overrides: {},
                  }
                : null,
            );
            setEditing(false);
          }}
        />
      )}
      {scenes.isError && (
        <p role="alert">
          白模场景读取失败。
          <button type="button" onClick={() => void scenes.refetch()}>
            重试
          </button>
        </p>
      )}
      {shot.previs && (
        <p>
          {scene?.title ??
            (scenes.isPending ? "正在读取场景…" : "原场景不可用")}{" "}
          · v{shot.previs.stage_revision}
        </p>
      )}
      {outputs.length > 0 && (
        <div className="storyboard-previs-outputs">
          {outputs.map((node) => (
            <button
              key={node.id}
              type="button"
              disabled={disabled}
              aria-label={`查看预演输出 ${node.title}`}
              onClick={() => onOutput(node.id)}
            >
              <span>
                <OutputPreview
                  kind={node.kind}
                  assetId={node.kind === "text" ? undefined : node.asset_id}
                  compact
                />
              </span>
              <small>{node.title}</small>
            </button>
          ))}
        </div>
      )}
      {shot.previs && !outputs.length && <small>暂无已导出的预演结果</small>}
      {onOpen && (
        <button type="button" disabled={disabled} onClick={onOpen}>
          打开镜头白模预演
        </button>
      )}
    </section>
  );
}
