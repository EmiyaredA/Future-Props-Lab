import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { getTextModels, textModelsKey } from "./scriptAnalysis";

export function TextModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const models = useQuery({ queryKey: textModelsKey, queryFn: getTextModels });
  return (
    <CustomSelect
      escapeClipping={false}
      ariaLabel="文本模型"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={(models.data ?? []).map((model) => ({
        value: model.id,
        label: model.label,
      }))}
      placeholder={
        models.isPending
          ? "读取文本模型…"
          : models.data?.length
            ? "选择文本模型"
            : "暂无可用文本模型"
      }
    />
  );
}
