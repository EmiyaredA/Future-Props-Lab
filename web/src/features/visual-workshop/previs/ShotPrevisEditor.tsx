import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type Ref, type ComponentProps } from "react";
import { PrevisEditor, type PrevisEditorHandle } from "./PrevisEditor";
import { composeShot, shotOverrides, ensureShotCamera } from "./shotScope";
import { getStoryboard, saveStoryboard } from "../storyboard/api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { openPrevis, type PrevisScene } from "./api";
import { apiErrorMessage } from "@platform/api/errors";
export function ShotPrevisEditor({
  ref,
  shotId,
  ...props
}: Omit<ComponentProps<typeof PrevisEditor>, "ref"> & {
  ref: Ref<PrevisEditorHandle>;
  shotId: string;
}) {
  const client = useQueryClient();
  const board = useQuery({
    queryKey: keys.storyboard(props.project),
    queryFn: ({ signal }) => getStoryboard(props.project, signal),
  });
  const [cameraId, setCameraId] = useState<string>();
  const shot = board.data?.shots.find((row) => row.id === shotId);
  if (board.isPending) return <p role="status">正在读取镜头预演…</p>;
  if (!board.data || !shot)
    return (
      <p role="alert">
        {board.error ? apiErrorMessage(board.error) : "镜头已删除，请返回分镜"}
      </p>
    );
  const document = {
    ...props.initial,
    document: ensureShotCamera(
      composeShot(
        props.initial.document,
        shot.previs?.scene_id === props.initial.id ? shot.previs : null,
      ),
      shot,
    ),
  };
  async function persist(value: PrevisScene): Promise<PrevisScene> {
    if (!board.data || !shot) throw new Error("镜头不可用");
    const stage = await openPrevis(props.project, props.initial.id);
    if (stage.revision !== props.initial.revision)
      throw new Error(
        "共享舞台已更新，请返回场景列表重新打开；本地镜头草稿仍保留。",
      );
    const overrides = shotOverrides(stage.document, value.document);
    const saved = await saveStoryboard(props.project, {
      ...board.data,
      shots: board.data.shots.map((row) =>
        row.id === shotId
          ? {
              ...row,
              previs: {
                scene_id: stage.id,
                stage_revision: stage.revision,
                camera_id:
                  cameraId ??
                  shot.previs?.camera_id ??
                  (value.document.cameras as { id: string }[] | undefined)?.[0]
                    ?.id ??
                  null,
                overrides,
              },
            }
          : row,
      ),
    });
    client.setQueryData(keys.storyboard(props.project), saved);
    return value;
  }
  return (
    <PrevisEditor
      {...props}
      ref={ref}
      initial={document}
      initialDirty={
        JSON.stringify(shot.previs?.overrides?.cameras ?? []) !==
        JSON.stringify(document.document.cameras ?? [])
      }
      initialCameraId={shot.previs?.camera_id ?? undefined}
      onCameraChange={setCameraId}
      persistScene={persist}
      validateChange={(value) => {
        shotOverrides(props.initial.document, value);
        return value;
      }}
      reloadScene={async () => {
        const [stage, latest] = await Promise.all([
          openPrevis(props.project, props.initial.id),
          getStoryboard(props.project),
        ]);
        if (stage.revision !== props.initial.revision)
          throw new Error("舞台版本已变化，请返回列表重新打开镜头");
        client.setQueryData(keys.storyboard(props.project), latest);
        const link = latest.shots.find((row) => row.id === shotId)?.previs;
        return {
          ...stage,
          document: composeShot(
            stage.document,
            link?.scene_id === stage.id ? link : null,
          ),
        };
      }}
    />
  );
}
