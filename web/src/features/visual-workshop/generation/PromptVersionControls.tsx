import { useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import type { PromptVersion, usePromptVersions } from "./usePromptVersions";
import "./prompt-versions.css";

export function PromptVersionControls({
  versions,
}: {
  versions: ReturnType<typeof usePromptVersions>;
}) {
  const [dialog, setDialog] = useState<{
    action: "rename" | "delete";
    version: PromptVersion;
  }>();
  const active = versions.prompt_versions.find(
    (version) => version.id === versions.active_prompt_version_id,
  )!;
  const atLimit = versions.prompt_versions.length >= 20;
  return (
    <div
      className="prompt-version-controls"
      role="group"
      aria-label="提示词版本管理"
      onSubmit={(event) => event.stopPropagation()}
    >
      <div className="prompt-version-selection">
        <span>提示词版本</span>
        <CustomSelect
          ariaLabel="提示词版本"
          value={versions.active_prompt_version_id}
          options={versions.prompt_versions.map((version) => ({
            value: version.id,
            label: version.name,
          }))}
          onChange={versions.select}
        />
      </div>
      <div className="prompt-version-actions">
        <button
          type="button"
          aria-label="新增提示词版本"
          disabled={atLimit}
          title={atLimit ? "最多保留 20 个版本" : "新增空白版本"}
          onClick={() => versions.add()}
        >
          <Plus size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="复制提示词版本"
          disabled={atLimit}
          title={atLimit ? "最多保留 20 个版本" : "复制当前版本"}
          onClick={() => versions.add(true)}
        >
          <Copy size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="重命名提示词版本"
          title="重命名当前版本"
          onClick={() => setDialog({ action: "rename", version: active })}
        >
          <Pencil size={14} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="删除提示词版本"
          disabled={versions.prompt_versions.length <= 1}
          title={
            versions.prompt_versions.length <= 1
              ? "至少保留一个版本"
              : "删除当前版本"
          }
          onClick={() => setDialog({ action: "delete", version: active })}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <TextInputDialog
        open={dialog?.action === "rename"}
        title="重命名提示词版本"
        label="版本名称"
        initialValue={dialog?.version.name}
        maxLength={120}
        onCancel={() => setDialog(undefined)}
        onConfirm={(name) => {
          if (dialog) versions.rename(dialog.version.id, name);
          setDialog(undefined);
        }}
      />
      <ConfirmDialog
        open={dialog?.action === "delete"}
        title="删除提示词版本"
        description={`确定删除「${dialog?.version.name ?? ""}」及其提示词内容？`}
        confirmLabel="删除版本"
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          if (dialog) versions.remove(dialog.version.id);
          setDialog(undefined);
        }}
      />
    </div>
  );
}
