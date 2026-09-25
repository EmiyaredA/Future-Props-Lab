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
  influence,
  setInfluence,
  showWeights,
  setShowWeights,
  brush,
  setBrush,
  brushRadius,
  setBrushRadius,
  brushStrength,
  setBrushStrength,
  trial,
  setTrial,
}: {
  doc: CharacterDocument;
  selected: string;
  vertexIndex: number;
  setVertexIndex: (value: number) => void;
  edit: Edit;
  readOnly: boolean;
  influence: string;
  setInfluence: (value: string) => void;
  showWeights: boolean;
  setShowWeights: (value: boolean) => void;
  brush: boolean;
  setBrush: (value: boolean) => void;
  brushRadius: number;
  setBrushRadius: (value: number) => void;
  brushStrength: number;
  setBrushStrength: (value: number) => void;
  trial: { rotation: number; offsetX: number; offsetY: number };
  setTrial: (value: {
    rotation: number;
    offsetX: number;
    offsetY: number;
  }) => void;
}) {
  const bone = doc.bones.find((item) => item.id === selected);
  const part = doc.parts.find((item) => item.id === selected);
  const selectedBone =
    doc.bones.find((item) => item.id === influence) ?? doc.bones[0];
  const weights = part?.skinWeights?.[vertexIndex] ?? [];
  const boneOptions = doc.bones.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  const validParents = boneOptions.filter(({ value }) => {
    if (!bone) return true;
    let parent: string | null | undefined = value;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (parent === bone.id) return false;
      visited.add(parent);
      parent = doc.bones.find((item) => item.id === parent)?.parentId;
    }
    return true;
  });
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
            options={[{ value: "", label: "无" }, ...validParents]}
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
          <div className="l2-panel-heading">
            <h2>静态姿态试调</h2>
          </div>
          <p className="l2-hint">
            只影响当前预览，不写入骨骼或动画。可检查关节与发束接缝。
          </p>
          <div className="l2-two">
            <Numeric
              label="试调旋转"
              value={trial.rotation}
              min={-90}
              max={90}
              onChange={(rotation) => setTrial({ ...trial, rotation })}
            />
            <Numeric
              label="试调 X"
              value={trial.offsetX}
              min={-200}
              max={200}
              onChange={(offsetX) => setTrial({ ...trial, offsetX })}
            />
            <Numeric
              label="试调 Y"
              value={trial.offsetY}
              min={-200}
              max={200}
              onChange={(offsetY) => setTrial({ ...trial, offsetY })}
            />
          </div>
          <button
            className="l2-full"
            onClick={() => setTrial({ rotation: 0, offsetX: 0, offsetY: 0 })}
          >
            重置试调姿态
          </button>
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
          <div className="l2-tree-actions">
            <button
              aria-pressed={showWeights}
              onClick={() => setShowWeights(!showWeights)}
            >
              权重热图
            </button>
            <button
              aria-pressed={brush}
              disabled={readOnly || !selectedBone || !part.skinWeights}
              onClick={() => {
                setBrush(!brush);
                setShowWeights(true);
              }}
            >
              权重画笔
            </button>
          </div>
          {brush && (
            <div className="l2-two">
              <Numeric
                label="画笔半径"
                value={brushRadius}
                min={5}
                max={250}
                onChange={setBrushRadius}
              />
              <Numeric
                label="目标权重"
                value={brushStrength}
                min={0.01}
                max={1}
                step={0.05}
                onChange={setBrushStrength}
              />
            </div>
          )}
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
