import type { ModelTestGenerationOption } from "@features/models/api";

type Capabilities = NonNullable<
  ModelTestGenerationOption["workflow_capabilities"]
>;
const labels: Record<string, string> = {
  megapixels: "百万像素",
  upscale_factor: "放大倍率",
  width: "宽度",
  height: "高度",
  seed: "种子（可选）",
};
export function WorkflowVideoControls({
  capabilities,
  values,
  onChange,
}: {
  capabilities: Capabilities;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return (
    <>
      {Object.entries(capabilities.parameters).map(([name, spec]) => (
        <label key={name}>
          <span>{labels[name] ?? name}</span>
          <input
            type="number"
            aria-label={labels[name] ?? name}
            min={spec.minimum}
            max={spec.maximum}
            step={spec.step}
            required={spec.default != null}
            value={
              values[name] ?? (spec.default == null ? "" : String(spec.default))
            }
            placeholder={
              name === "seed" ? "随机（实际种子保存在任务记录）" : undefined
            }
            onChange={(event) =>
              onChange({ ...values, [name]: event.target.value })
            }
          />
        </label>
      ))}
      <p>工作流联合生成视频和音频；未上传的参考槽位不使用示例素材。</p>
    </>
  );
}
