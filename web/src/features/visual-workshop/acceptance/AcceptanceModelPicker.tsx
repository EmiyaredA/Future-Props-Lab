import type { components } from "@generated/api";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import "./model-picker.css";

type Model = components["schemas"]["AcceptanceModelOut"];

export function AcceptanceModelPicker({
  models,
  value,
  onChange,
}: {
  models: Model[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <CustomSelect
      ariaLabel="验收视觉模型"
      className="acceptance-model-select"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: "请选择视觉模型" },
        ...models.map((model) => ({
          value: model.id,
          label: `${model.label} · ${model.slug} · ${model.provider_name}`,
        })),
      ]}
      renderOption={(option) => {
        const model = models.find((item) => item.id === option.value);
        if (!model) return <span>{option.label}</span>;
        return (
          <span className="acceptance-model-card">
            <span className="acceptance-model-icon" aria-hidden="true">
              <ProviderIcon kind={model.provider_kind} size={24} />
            </span>
            <span className="acceptance-model-copy">
              <strong>{model.label}</strong>
              <code>{model.slug}</code>
              <span className="acceptance-model-provider">
                {model.provider_name}
              </span>
            </span>
          </span>
        );
      }}
    />
  );
}
