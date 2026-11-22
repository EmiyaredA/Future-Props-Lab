import * as Tabs from "@radix-ui/react-tabs";
import { FileText, Link2, Sparkles } from "lucide-react";

export function CardEditorTabs({
  readOnly,
  canGenerate,
}: {
  readOnly: boolean;
  canGenerate: boolean;
}) {
  return (
    <Tabs.List className="card-editor-tabs" aria-label="设定卡编辑分区">
      <Tabs.Trigger value="design">
        <FileText size={15} aria-hidden /> 设定
      </Tabs.Trigger>
      {!readOnly && (
        <Tabs.Trigger value="materials">
          <Link2 size={15} aria-hidden /> 关联
        </Tabs.Trigger>
      )}
      {!readOnly && canGenerate && (
        <Tabs.Trigger value="generation">
          <Sparkles size={15} aria-hidden /> 生成
        </Tabs.Trigger>
      )}
    </Tabs.List>
  );
}
