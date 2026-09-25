import { useState } from "react";
import { Choice, Numeric } from "./Controls";
import type { Edit } from "./Inspector";
import type { Camera, CharacterDocument } from "./types";

const labels = { avatar: "头像相机位", stage: "半身舞台相机位" } as const;
type CameraName = keyof typeof labels;
type BehaviorKey =
  | "blinkParameter"
  | "gazeXParameter"
  | "gazeYParameter"
  | "breathParameter"
  | "swayParameter";

export function CameraBehaviorPanel({
  doc,
  edit,
  readOnly,
}: {
  doc: CharacterDocument;
  edit: Edit;
  readOnly: boolean;
}) {
  const [cameraName, setCameraName] = useState<CameraName>("avatar");
  const camera = doc.cameras[cameraName] ?? {
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
  };
  const updateCamera = (key: keyof Camera, value: number) =>
    edit((draft) => {
      const current = draft.cameras[cameraName] ?? {
        x: 0,
        y: 0,
        width: draft.width,
        height: draft.height,
      };
      const next = { ...current, [key]: value };
      next.x = Math.min(next.x, draft.width - next.width);
      next.y = Math.min(next.y, draft.height - next.height);
      next.width = Math.min(next.width, draft.width - next.x);
      next.height = Math.min(next.height, draft.height - next.y);
      draft.cameras[cameraName] = next;
    });
  const behaviorFields: [BehaviorKey, string][] = [
    ["blinkParameter", "眨眼参数"],
    ["gazeXParameter", "水平视线参数"],
    ["gazeYParameter", "垂直视线参数"],
    ["breathParameter", "呼吸参数"],
    ["swayParameter", "姿态微动参数"],
  ];
  return (
    <section className="l2-camera-panel">
      <div className="l2-panel-heading">
        <h2>取景与待机表现</h2>
      </div>
      <Choice
        label="相机位"
        value={cameraName}
        options={Object.entries(labels).map(([value, label]) => ({
          value,
          label,
        }))}
        onChange={(value) => setCameraName(value as CameraName)}
      />
      <div className="l2-two">
        <Numeric
          label="起点 X"
          value={camera.x}
          min={0}
          max={doc.width - camera.width}
          disabled={readOnly}
          onChange={(value) => updateCamera("x", value)}
        />
        <Numeric
          label="起点 Y"
          value={camera.y}
          min={0}
          max={doc.height - camera.height}
          disabled={readOnly}
          onChange={(value) => updateCamera("y", value)}
        />
        <Numeric
          label="宽"
          value={camera.width}
          min={32}
          max={doc.width - camera.x}
          disabled={readOnly}
          onChange={(value) => updateCamera("width", value)}
        />
        <Numeric
          label="高"
          value={camera.height}
          min={32}
          max={doc.height - camera.y}
          disabled={readOnly}
          onChange={(value) => updateCamera("height", value)}
        />
      </div>
      <p className="l2-hint">
        头像按 48px / 76px 检查，舞台按 360px 宽检查。画布上的框标出当前相机位。
      </p>
      {behaviorFields.map(([key, label]) => (
        <Choice
          key={key}
          label={label}
          value={doc.idleBehavior[key] ?? ""}
          disabled={readOnly}
          options={[
            { value: "", label: "关闭" },
            ...doc.parameters.map((parameter) => ({
              value: parameter.id,
              label: parameter.name,
            })),
          ]}
          onChange={(value) =>
            edit((draft) => {
              draft.idleBehavior[key] = value || null;
            })
          }
        />
      ))}
      <Numeric
        label="待机强度"
        value={doc.idleBehavior.intensity ?? 0.5}
        min={0}
        max={1}
        step={0.05}
        disabled={readOnly}
        onChange={(value) =>
          edit((draft) => {
            draft.idleBehavior.intensity = value;
          })
        }
      />
    </section>
  );
}
