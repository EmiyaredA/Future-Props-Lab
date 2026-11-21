import { CustomSelect } from "@shared/ui/CustomSelect";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { apiErrorMessage } from "@platform/api/errors";
import {
  getGenerationOptions,
  uploadMaterialNode,
  type VisualCanvasVideoGenerationDraft,
} from "../api";
import type { BoardController } from "../board/boardTypes";
import type { PrevisScene } from "./api";
import { adoptReferenceDraft } from "./adoptReference";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
export type PrevisAdoption = {
  scene: PrevisScene;
  file: File;
  number: number;
  nodeId: string;
};
export function PrevisReferenceDialog({
  value,
  controller: c,
  onClose,
  onAdopted,
}: {
  value: PrevisAdoption;
  controller: BoardController;
  onClose: () => void;
  onAdopted: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(value.file);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);
  const options = useQuery({
    queryKey: keys.generationOptions,
    queryFn: getGenerationOptions,
  });
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(crypto.randomUUID());
  const uploaded = useRef<string | undefined>(undefined);
  const node = c.nodes.find((row) => row.id === value.nodeId);
  const patched = useRef(false);
  const baseline = useRef(
    JSON.stringify(node && node.kind !== "text" ? node.generation_draft : null),
  );
  const kind = value.file.type.startsWith("image/") ? "image" : "video";
  const draft =
    node?.kind === "image" || node?.kind === "video"
      ? node.generation_draft
      : undefined;
  const references =
    kind === "video"
      ? ((draft as VisualCanvasVideoGenerationDraft | undefined)
          ?.video_asset_ids ?? [])
      : [
          ...new Set([
            ...(draft?.reference_asset_ids ?? []),
            ...("reference_asset_id" in (draft ?? {}) &&
            (draft as { reference_asset_id?: string }).reference_asset_id
              ? [(draft as { reference_asset_id: string }).reference_asset_id]
              : []),
          ]),
        ];
  async function adopt() {
    if (busy || !options.data) return;
    setBusy(true);
    setError("");
    try {
      const current = c
        .readCanvas()
        .nodes.find((row) => row.id === value.nodeId);
      if (!current || current.kind === "text")
        throw new Error("目标制作节点已删除");
      if (JSON.stringify(current.generation_draft) !== baseline.current)
        throw new Error(
          "制作设置已在其他入口变化，请关闭并重新采用，避免覆盖修改",
        );
      if (patched.current) {
        await c.prepareCanvasForAgent();
        onAdopted();
        return;
      }
      const linked = c.edges
        .filter((edge) => edge.target_node_id === current.id)
        .flatMap((edge) => {
          const source = c.nodes.find((row) => row.id === edge.source_node_id);
          return source && source.kind === kind && source.asset_id
            ? [source.asset_id]
            : [];
        });
      const checked = adoptReferenceDraft(
        current,
        kind,
        uploaded.current ?? "pending",
        replace,
        options.data,
        linked,
      );
      if (
        checked.supportedMimes?.length &&
        !checked.supportedMimes.includes(value.file.type)
      )
        throw new Error("当前模型不接收此文件格式，请更换模型或导出格式");
      const revision = await c.prepareCanvasForAgent();
      if (!uploaded.current) {
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              await value.file.arrayBuffer(),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        const canvas = await uploadMaterialNode(
          c.projectId,
          value.file,
          revision,
          c.getInsertionAnchor(),
          undefined,
          undefined,
          {
            request_id: request.current,
            scene_id: value.scene.id,
            scene_revision: value.scene.revision,
            shot_number: value.number,
            artifact_kind: kind === "image" ? "frame" : "clip",
            sha256: digest,
          },
        );
        const source = canvas.nodes.find(
          (row) => row.id === `previs-${request.current}`,
        );
        if (!source || source.kind === "text" || !source.asset_id)
          throw new Error("文件已上传，但预演素材节点尚未返回；请重试");
        uploaded.current = source.asset_id;
        c.applyServerCanvas(canvas);
      }
      const updated = adoptReferenceDraft(
        current,
        kind,
        uploaded.current,
        replace,
        options.data,
        linked,
      ).draft;
      if (current.kind === "image")
        c.patchNode(
          current.id,
          {
            generation_draft:
              updated as import("../api").VisualCanvasImageGenerationDraft,
          },
          true,
        );
      else if (current.kind === "video")
        c.patchNode(
          current.id,
          { generation_draft: updated as VisualCanvasVideoGenerationDraft },
          true,
        );
      // Persist the node draft before returning to its generation editor.
      patched.current = true;
      const patchedNode = c
        .readCanvas()
        .nodes.find((row) => row.id === current.id);
      baseline.current = JSON.stringify(
        patchedNode && patchedNode.kind !== "text"
          ? patchedNode.generation_draft
          : updated,
      );
      await c.prepareCanvasForAgent();
      onAdopted();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open
      tone="primary"
      confirmDisabled={!options.data}
      title="采用预演结果"
      confirmLabel={replace ? "替换参考素材" : "加入参考素材"}
      pending={busy}
      onCancel={onClose}
      onConfirm={adopt}
      description={
        <div className="previs-adoption">
          <p>
            {node?.title ?? "制作节点不可用"} · {value.file.name}
          </p>
          {kind === "image" ? (
            <img src={url || undefined} alt="预演帧" />
          ) : (
            <video src={url || undefined} controls />
          )}
          <label>
            加入方式
            <CustomSelect
              ariaLabel="采用预演加入方式"
              value={replace}
              disabled={busy || Boolean(uploaded.current)}
              onChange={setReplace}
              options={[
                { value: "", label: "新增为参考素材" },
                ...references.map((id, index) => ({
                  value: id,
                  label: `替换${kind === "image" ? "图片" : "视频"} ${index + 1}`,
                })),
              ]}
            />
          </label>
          <p>确认后返回分镜核对提示词与实际输入，再手动生成。</p>
          {error && <p role="alert">{error}</p>}
          {options.isError && (
            <p role="alert">
              模型能力读取失败
              <button onClick={() => void options.refetch()}>重试</button>
            </p>
          )}
        </div>
      }
    />
  );
}
