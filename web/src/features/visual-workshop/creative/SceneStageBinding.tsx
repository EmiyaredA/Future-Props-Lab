import { CustomSelect } from "@shared/ui/CustomSelect";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, ExternalLink } from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { createSceneDocument } from "../../../../vendor/toonflow/trumanScene";
import { createPrevis, listPrevis } from "../previs/api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { getStoryboard } from "../storyboard/api";
import {
  creationLinksKey,
  getCreationLinks,
  saveCreationLinks,
} from "./creationLinks";

export function SceneStageBinding({
  project,
  cardId,
  title,
  readOnly,
  onOpen,
}: {
  project: string;
  cardId: string;
  title: string;
  readOnly: boolean;
  onOpen?: (id: string) => void;
}) {
  const client = useQueryClient();
  const links = useQuery({
    queryKey: creationLinksKey(project),
    queryFn: ({ signal }) => getCreationLinks(project, signal),
  });
  const stages = useQuery({
    queryKey: keys.previs(project),
    queryFn: ({ signal }) => listPrevis(project, signal),
  });
  const board = useQuery({
    queryKey: keys.storyboard(project),
    queryFn: ({ signal }) => getStoryboard(project, signal),
  });
  const current =
    links.data?.scenes?.find((entry) => entry.card_id === cardId)
      ?.previs_scene_id ?? "";
  const [selection, setSelection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = selection ?? current;
  async function bind(id: string) {
    if (!links.data) throw new Error("请先读取场景绑定");
    const saved = await saveCreationLinks(project, {
      ...links.data,
      scenes: [
        ...(links.data.scenes ?? []).filter((row) => row.card_id !== cardId),
        ...(id ? [{ card_id: cardId, previs_scene_id: id }] : []),
      ],
    });
    client.setQueryData(creationLinksKey(project), saved);
    setSelection(undefined);
  }
  function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    void action()
      .catch((failure) => setError(apiErrorMessage(failure)))
      .finally(() => setBusy(false));
  }
  const stage = stages.data?.find((row) => row.id === current);
  return (
    <section className="scene-stage-binding" aria-label="3D 场景绑定">
      <h3>
        <Box size={16} /> 关联 3D 场景
      </h3>
      <p>此项目的镜头可共用同一舞台，并分别保存机位与走位。</p>
      <CustomSelect
        ariaLabel="项目 3D 场景"
        disabled={busy || readOnly || !links.data}
        value={selected}
        onChange={setSelection}
        options={[
          { value: "", label: "未绑定" },
          ...(stages.data?.map((row) => ({
            value: row.id,
            label: row.title,
          })) ?? []),
          ...(current && !stage
            ? [{ value: current, label: "原场景已删除" }]
            : []),
        ]}
      />
      {!readOnly && (
        <div>
          <button
            type="button"
            disabled={busy || !links.data || selected === current}
            onClick={() => run(() => bind(selected))}
          >
            保存绑定
          </button>
          <button
            type="button"
            disabled={busy || !links.data}
            onClick={() =>
              run(async () => {
                const created = await createPrevis(project, {
                  title: title.slice(0, 120),
                  format_version: 1,
                  document: createSceneDocument(),
                });
                setSelection(created.id);
                await client.invalidateQueries({
                  queryKey: keys.previs(project),
                });
                await bind(created.id);
              })
            }
          >
            新建 3D 场景并绑定
          </button>
        </div>
      )}
      {stage && (
        <button
          type="button"
          disabled={busy || !onOpen}
          onClick={() => onOpen?.(stage.id)}
        >
          <ExternalLink size={14} /> 打开 {stage.title}
        </button>
      )}
      {current && (
        <small>
          使用此舞台：
          {board.data?.shots.filter((shot) => shot.previs?.scene_id === current)
            .length ?? "—"}{" "}
          个镜头
        </small>
      )}
      {(error || links.isError || stages.isError) && (
        <p role="alert">
          {error || "场景绑定读取失败"}
          <button
            type="button"
            onClick={() => {
              void links.refetch();
              void stages.refetch();
            }}
          >
            重新读取
          </button>
        </p>
      )}
    </section>
  );
}
