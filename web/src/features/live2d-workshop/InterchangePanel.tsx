import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Choice, Modal } from "./Controls";
import {
  exportCubismExpression,
  exportCubismMotion,
  inspectCubismImport,
  type InterchangePreview,
} from "./cubismInterchange";
import { saveHandoff } from "./psdHandoff";
import type { Edit } from "./Inspector";
import type { CharacterDocument } from "./types";

const states = [
  ["idle", "待命"],
  ["listening", "聆听中"],
  ["thinking", "思考中"],
  ["tool", "执行中"],
  ["success", "已完成"],
  ["error", "需要关注"],
  ["paused", "已暂停"],
] as const;

export function InterchangePanel({
  doc,
  edit,
  motionId,
  expressionId,
  setMotion,
  setExpression,
  readOnly,
}: {
  doc: CharacterDocument;
  edit: Edit;
  motionId: string;
  expressionId: string;
  setMotion: (id: string) => void;
  setExpression: (id: string) => void;
  readOnly: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<InterchangePreview | null>(null);
  const [message, setMessage] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const importFile = async (file: File) => {
    setMessage("");
    if (file.size > 2 * 1024 * 1024) {
      setMessage("动作或表情 JSON 不能超过 2 MiB");
      return;
    }
    try {
      setPreview(
        inspectCubismImport(JSON.parse(await file.text()), file.name, doc),
      );
    } catch {
      setMessage("文件不是有效 JSON");
    }
  };
  const downloadJson = (kind: "motion" | "expression") => {
    try {
      if (kind === "motion" && motionId) {
        const motion = doc.motions.find((item) => item.id === motionId)!;
        saveHandoff(
          new Blob([JSON.stringify(exportCubismMotion(doc, motion), null, 2)], {
            type: "application/json",
          }),
          `${motion.name}.motion3.json`,
        );
      } else if (kind === "expression" && expressionId) {
        const expression = doc.expressions.find(
          (item) => item.id === expressionId,
        )!;
        saveHandoff(
          new Blob(
            [JSON.stringify(exportCubismExpression(doc, expression), null, 2)],
            { type: "application/json" },
          ),
          `${expression.name}.exp3.json`,
        );
      }
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "导出失败");
    }
  };
  return (
    <>
      <hr />
      <details className="l2-interchange">
        <summary>Cubism 参数与文件互通</summary>
        <p className="l2-hint">
          参数 ID 须与另行制作的 Cubism
          模型一致；模型网格和绑定不会随动作文件转移。
        </p>
        {doc.parameters.map((parameter) => (
          <label className="l2-field" key={parameter.id}>
            {parameter.name} · {parameter.id}
            <input
              disabled={readOnly}
              value={
                mapping[parameter.id] ??
                doc.cubismParameterIds[parameter.id] ??
                ""
              }
              placeholder={parameter.id}
              onChange={(event) =>
                setMapping((previous) => ({
                  ...previous,
                  [parameter.id]: event.target.value,
                }))
              }
              onBlur={() => {
                const value = mapping[parameter.id]?.trim();
                if (value === undefined) return;
                if (
                  value.length > 120 ||
                  (value &&
                    doc.parameters.some(
                      (other) =>
                        other.id !== parameter.id &&
                        (doc.cubismParameterIds[other.id] || other.id) ===
                          value,
                    ))
                ) {
                  setMessage("Cubism 参数 ID 必须唯一且不超过 120 个字符");
                  return;
                }
                edit((draft) => {
                  if (value) draft.cubismParameterIds[parameter.id] = value;
                  else delete draft.cubismParameterIds[parameter.id];
                });
                setMapping((previous) => {
                  const next = { ...previous };
                  delete next[parameter.id];
                  return next;
                });
              }}
            />
          </label>
        ))}
        <div className="l2-tree-actions">
          <button disabled={readOnly} onClick={() => input.current?.click()}>
            <Upload size={14} />
            导入动作／表情 JSON
          </button>
          <button disabled={!motionId} onClick={() => downloadJson("motion")}>
            <Download size={14} />
            导出当前动作
          </button>
          <button
            disabled={!expressionId}
            onClick={() => downloadJson("expression")}
          >
            <Download size={14} />
            导出当前表情
          </button>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          accept=".motion3.json,.exp3.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
        {message && (
          <p role="alert" className="l2-interchange-error">
            {message}
          </p>
        )}
      </details>
      <hr />
      <details className="l2-interchange">
        <summary>Amadeus 执行状态绑定</summary>
        <p className="l2-hint">
          选择状态可在工坊预览对应表情与动作；头像接入将在模型完成后进行。
        </p>
        {states.map(([state, label]) => {
          const binding = doc.stateBindings[state] ?? {};
          return (
            <div className="l2-state-row" key={state}>
              <button
                onClick={() => {
                  setExpression(binding.expressionId ?? "");
                  setMotion(binding.motionId ?? "");
                }}
              >
                {label} · 预览
              </button>
              <Choice
                label={`${label}表情`}
                disabled={readOnly}
                value={binding.expressionId ?? ""}
                onChange={(value) =>
                  edit((draft) => {
                    draft.stateBindings[state] = {
                      ...draft.stateBindings[state],
                      expressionId: value || null,
                    };
                  })
                }
                options={[
                  { value: "", label: "默认表情" },
                  ...doc.expressions.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
              <Choice
                label={`${label}动作`}
                disabled={readOnly}
                value={binding.motionId ?? ""}
                onChange={(value) =>
                  edit((draft) => {
                    draft.stateBindings[state] = {
                      ...draft.stateBindings[state],
                      motionId: value || null,
                    };
                  })
                }
                options={[
                  { value: "", label: "静态姿态" },
                  ...doc.motions.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </div>
          );
        })}
      </details>
      <Modal
        title="导入 Cubism 参数数据"
        description={
          preview
            ? `${preview.name} · ${preview.kind === "motion" ? "动作" : "表情"}`
            : ""
        }
        open={!!preview}
        onClose={() => setPreview(null)}
      >
        <div className="l2-import-review">
          {preview?.issues.length ? (
            preview.issues.map((issue, index) => (
              <p
                key={index}
                role={issue.level === "error" ? "alert" : "status"}
              >
                {issue.level === "error" ? "错误" : "转换提示"}：{issue.message}
              </p>
            ))
          ) : (
            <p>参数与范围检查通过，可导入。</p>
          )}
          <div className="l2-actions">
            <button onClick={() => setPreview(null)}>取消</button>
            <button
              className="l2-primary"
              disabled={
                readOnly ||
                !preview ||
                preview.issues.some((issue) => issue.level === "error")
              }
              onClick={() => {
                if (!preview) return;
                const selected = preview;
                edit((draft) => {
                  if (selected.motion) draft.motions.push(selected.motion);
                  if (selected.expression)
                    draft.expressions.push(selected.expression);
                });
                if (selected.motion) setMotion(selected.motion.id);
                if (selected.expression) setExpression(selected.expression.id);
                setPreview(null);
              }}
            >
              导入并保存到工程
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
