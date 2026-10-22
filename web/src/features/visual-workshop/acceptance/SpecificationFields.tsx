import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Criterion } from "./api";
export function SpecificationFields({
  value,
  onChange,
}: {
  value: Criterion["specifications"];
  onChange: (value: Criterion["specifications"]) => void;
}) {
  return (
    <div className="acceptance-specifications">
      {(
        [
          ["min_width", "最小宽度"],
          ["min_height", "最小高度"],
          ["min_duration", "最短秒数"],
          ["max_duration", "最长秒数"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={key.includes("duration") ? 0 : 1}
            value={value?.[key] ?? ""}
            onChange={(event) =>
              onChange({
                require_audio: false,
                ...value,
                [key]:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </label>
      ))}
      <label>
        画幅
        <CustomSelect
          value={value?.ratio ?? ""}
          ariaLabel="验收画幅"
          options={[
            { value: "", label: "不限" },
            ...["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => ({
              value,
              label: value,
            })),
          ]}
          onChange={(ratio) =>
            onChange({
              require_audio: false,
              ...value,
              ratio: (ratio || null) as NonNullable<
                Criterion["specifications"]
              >["ratio"],
            })
          }
        />
      </label>
      <label className="acceptance-check-label">
        <input
          type="checkbox"
          checked={value?.require_audio ?? false}
          onChange={(event) =>
            onChange({ ...value, require_audio: event.target.checked })
          }
        />
        视频必须包含音轨
      </label>
    </div>
  );
}
