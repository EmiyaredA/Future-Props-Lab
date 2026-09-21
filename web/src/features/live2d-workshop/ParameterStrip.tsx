import { captureKey } from "./model";
import type { Edit } from "./Inspector";
import type { CharacterDocument } from "./types";
export function ParameterStrip({
  doc,
  selected,
  parameterId,
  value,
  onValue,
  edit,
  readOnly,
}: {
  doc: CharacterDocument;
  selected: string;
  parameterId: string;
  value: number;
  onValue: (n: number) => void;
  edit: Edit;
  readOnly: boolean;
}) {
  const parameter = doc.parameters.find((p) => p.id === parameterId),
    binding = parameter?.bindings.find((b) => b.targetId === selected);
  if (!parameter) return null;
  const hasTarget = [...doc.parts, ...doc.deformers].some(
    (n) => n.id === selected,
  );
  return (
    <section className="l2-keyforms">
      <div>
        <strong>参数关键形</strong>
        <span>{parameter.name} · 形态随参数插值，与时间无关</span>
      </div>
      <div className="l2-keyform-row">
        {[
          ...new Set([
            parameter.minimum,
            parameter.default,
            parameter.maximum,
            ...(binding?.keys.map((k) => k.value) ?? []),
          ]),
        ]
          .sort((a, b) => a - b)
          .map((at) => (
            <button
              key={at}
              aria-pressed={value === at}
              onClick={() => onValue(at)}
            >
              <span
                className={
                  binding?.keys.some((k) => k.value === at) ? "filled" : ""
                }
              >
                ◇
              </span>
              <strong>
                {at === parameter.default
                  ? "默认"
                  : at === parameter.minimum
                    ? "最小"
                    : at === parameter.maximum
                      ? "最大"
                      : "中间"}
              </strong>
              <small>
                {at} ·{" "}
                {binding?.keys.some((k) => k.value === at)
                  ? "已记录"
                  : "未记录"}
              </small>
            </button>
          ))}
      </div>
      <div className="l2-actions">
        <button
          disabled={readOnly || !hasTarget}
          onClick={() =>
            edit((d) => captureKey(d, parameterId, selected, value))
          }
        >
          记录当前参数形态
        </button>
        <button
          disabled={
            readOnly ||
            !binding?.keys.some((k) => k.value === value) ||
            value === parameter.default
          }
          onClick={() =>
            edit((d) => {
              const p = d.parameters.find((p) => p.id === parameterId)!;
              const b = p.bindings.find((b) => b.targetId === selected)!;
              b.keys = b.keys.filter((k) => k.value !== value);
            })
          }
        >
          删除当前关键形
        </button>
      </div>
    </section>
  );
}
