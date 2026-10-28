import { Cpu } from "lucide-react";
import type { ComponentProps } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ProviderIcon } from "@shared/ui/ProviderIcon";
import type { AcceptanceScheme, SchemeId } from "./nodeApi";
import "./model-picker.css";

export function SchemeIcon({ scheme }: { scheme: AcceptanceScheme }) {
  if (scheme.kind === "code_agent") {
    const name = scheme.id === "motion-transfer:codex" ? "codex" : "claudecode";
    return (
      <span
        aria-hidden="true"
        data-software={name}
        className={`acceptance-software-icon ${name}`}
      />
    );
  }
  return scheme.provider_kind ? (
    <ProviderIcon
      kind={scheme.provider_kind as ComponentProps<typeof ProviderIcon>["kind"]}
      size={24}
    />
  ) : (
    <Cpu size={24} />
  );
}

export function AcceptanceSchemePicker({
  schemes,
  value,
  disabled,
  onChange,
}: {
  schemes: AcceptanceScheme[];
  value?: SchemeId | null;
  disabled: boolean;
  onChange: (id: SchemeId | null) => void;
}) {
  return (
    <CustomSelect
      ariaLabel="选择验收方案"
      className="acceptance-model-select acceptance-scheme-select"
      value={value ?? ""}
      disabled={disabled}
      onChange={(id) => onChange((id || null) as SchemeId | null)}
      options={[
        { value: "", label: "请选择内置方案" },
        ...schemes.map((scheme) => ({
          value: scheme.id,
          label: `动作迁移 · ${scheme.title}`,
        })),
      ]}
      renderOption={(option) => {
        const scheme = schemes.find((item) => item.id === option.value);
        if (!scheme) return <span>{option.label}</span>;
        return (
          <span className="acceptance-model-card">
            <span className="acceptance-model-icon" aria-hidden>
              <SchemeIcon scheme={scheme} />
            </span>
            <span className="acceptance-model-copy">
              <strong>{scheme.title}</strong>
              {scheme.model_slug && <code>{scheme.model_slug}</code>}
              <span className="acceptance-model-provider">
                {scheme.message}
              </span>
            </span>
          </span>
        );
      }}
    />
  );
}
