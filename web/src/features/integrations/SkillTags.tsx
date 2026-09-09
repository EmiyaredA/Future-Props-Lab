import { useId, useState } from "react";
import { IntegrationModal } from "@features/integrations/components";
import type { Skill } from "@features/integrations/api";

import { parseSkillTags } from "@features/integrations/skillTagValues";

export function SkillTagField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  const count = parseSkillTags(value).length;
  return (
    <label className="integration-field full">
      <span>标签（逗号分隔）</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hintId}
        aria-invalid={count > 12}
        placeholder="例如：MiniMax H3，视频生成，产品广告"
      />
      <small id={hintId} role={count > 12 ? "alert" : undefined}>
        {count > 12
          ? "最多添加 12 个标签，请减少后保存。"
          : `支持中英文逗号，已添加 ${count}/12 个标签。`}
      </small>
    </label>
  );
}

export function SkillTagDialog({
  skill,
  pending,
  error,
  onClose,
  onSave,
}: {
  skill: Skill;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [text, setText] = useState(skill.tags.join(", "));
  const tags = parseSkillTags(text);
  return (
    <IntegrationModal title={`编辑 ${skill.name} 标签`} onClose={onClose}>
      <form
        className="integration-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && tags.length <= 12) onSave(tags);
        }}
      >
        <SkillTagField value={text} onChange={setText} />
        {error ? <p role="alert">{error}</p> : null}
        <footer className="integration-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={pending || tags.length > 12}
          >
            {pending ? "保存中…" : "保存标签"}
          </button>
        </footer>
      </form>
    </IntegrationModal>
  );
}
