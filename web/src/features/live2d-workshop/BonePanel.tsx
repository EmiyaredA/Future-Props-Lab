import { useState } from "react";
import { Choice, Numeric } from "./Controls";
import { setVertexBoneWeight } from "./model";
import type { Edit } from "./Inspector";
import type { CharacterDocument } from "./types";

export function BonePanel({
  doc,
  selected,
  vertexIndex,
  setVertexIndex,
  edit,
  readOnly,
}: {
  doc: CharacterDocument;
  selected: string;
  vertexIndex: number;
  setVertexIndex: (value: number) => void;
  edit: Edit;
  readOnly: boolean;
}) {
  const bone = doc.bones.find((item) => item.id === selected);
  const part = doc.parts.find((item) => item.id === selected);
  const [influence, setInfluence] = useState("");
  const selectedBone =
    doc.bones.find((item) => item.id === influence) ?? doc.bones[0];
  const weights = part?.skinWeights?.[vertexIndex] ?? [];
  const boneOptions = doc.bones.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  const updateBone = (field: string, value: string | number | null) =>
    edit((next) => {
      Object.assign(
        next.bones.find((item) => item.id === bone?.id)!,
        { [field]: value },
      );
    });
  if (!bone && !part)
    return <p className="l2-hint">选择骨骼或图层，查看蒙皮设置。</p>;
  return (
    <section className="l2-bone-panel">
      <div className="l2-panel-heading">
        <h2>骨骼与蒙皮</h2>
      </div>
      {bone && (
        <>
          <label className="l2-field">
            名称
            <input
              value={bone.name}
              disabled={readOnly}
              onChange={(event) => updateBone("name", event.target.value)}
            />
          </label>
          <Choice
            label="父骨骼"
            value={bone.parentId ?? ""}
            disabled={readOnly}
            options={[
              { value: "", label: "无" },
              ...boneOptions.filter((item) => item.value !== bone.id),
            ]}
            onChange={(value) => updateBone("parentId", value || null)}
          />
          <div className="l2-two">
            <Numeric
              label="枢轴 X"
              value={bone.x}
              disabled={readOnly}
              min={0}
              max={doc.width}
              onChange={(value) => updateBone("x", value)}
            />
            <Numeric
              label="枢轴 Y"
              value={bone.y}
              disabled={readOnly}
              min={0}
              max={doc.height}
              onChange={(value) => updateBone("y", value)}
            />
            <Numeric
              label="旋转"
              value={bone.rotation}
              disabled={readOnly}
              min={-180}
              max={180}
              onChange={(value) => updateBone("rotation", value)}
            />
            <Numeric
              label="缩放"
              value={bone.scale}
              disabled={readOnly}
              min={0.01}
              max={4}
              step={0.01}
              onChange={(value) => updateBone("scale", value)}
            />
            <Numeric
              label="弹性"
              value={bone.spring}
              disabled={readOnly}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => updateBone("spring", value)}
            />
            <Numeric
              label="阻尼"
              value={bone.damping}
              disabled={readOnly}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => updateBone("damping", value)}
            />
          </div>
          <p className="l2-hint">
            旋转、平移和缩放可记录为参数关键形；弹性在运行时驱动次级摆动。
          </p>
        </>
      )}
      {part && doc.bones.length > 0 && (
        <>
          <Choice
            label="绑定骨骼"
            value={selectedBone?.id ?? ""}
            options={boneOptions}
            onChange={setInfluence}
          />
          <button
            className="l2-full"
            disabled={readOnly || !selectedBone}
            onClick={() =>
              edit((next) => {
                const target = next.parts.find((item) => item.id === part.id)!;
                target.parentId = null;
                target.skinWeights = target.vertices.map(() => [
                  { boneId: selectedBone.id, weight: 1 },
                ]);
              })
            }
          >
            整层绑定到这根骨骼
          </button>
          <Numeric
            label="当前顶点"
            value={vertexIndex + 1}
            min={1}
            max={part.vertices.length}
            onChange={(value) => setVertexIndex(Math.round(value) - 1)}
          />
          <p className="l2-hint">
            当前顶点：
            {weights
              .map(
                (item) =>
                  `${doc.bones.find((bone) => bone.id === item.boneId)?.name ?? item.boneId} ${(item.weight * 100).toFixed(0)}%`,
              )
              .join(" · ") || "尚未蒙皮"}
          </p>
          {part.skinWeights && selectedBone && (
            <Numeric
              label="所选骨骼权重"
              value={
                weights.find((item) => item.boneId === selectedBone.id)
                  ?.weight ?? 0
              }
              min={0}
              max={1}
              step={0.05}
              disabled={readOnly}
              onChange={(value) =>
                edit((next) => {
                  setVertexBoneWeight(
                    next.parts.find((item) => item.id === part.id)!,
                    vertexIndex,
                    selectedBone.id,
                    value,
                  );
                })
              }
            />
          )}
        </>
      )}
    </section>
  );
}
