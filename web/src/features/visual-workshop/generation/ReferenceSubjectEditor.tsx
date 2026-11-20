import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  subjectChoices,
  subjectLabel,
  validReferenceSubject,
} from "./referenceSubjects";

export function ReferenceSubjectEditor({
  value,
  title,
  onChange,
  disabled = false,
}: {
  value: string;
  title: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <>
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              className="reference-subject-label"
              disabled={disabled}
              aria-label={`追踪对象 ${title}`}
              onClick={() => {
                setDraft(value);
                setError("");
                setOpen(true);
              }}
            >
              <span>
                {disabled ? "待关联" : value ? subjectLabel(value) : "设置对象"}
              </span>
              <Pencil size={11} aria-hidden />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="reference-tooltip" sideOffset={5}>
              {value ? subjectLabel(value) : "设置追踪对象"}
              <Tooltip.Arrow />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="reference-dialog-overlay" />
          <Dialog.Content
            className="reference-dialog subject-editor"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <Dialog.Title>追踪对象</Dialog.Title>
              <Dialog.Close aria-label="关闭追踪对象">
                <X size={18} />
              </Dialog.Close>
            </header>
            <Dialog.Description>
              {title}：选择常用对象，或填写英文目标短语。
            </Dialog.Description>
            <div className="reference-subject-choices">
              {subjectChoices.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={value === item.value}
                  onClick={() => choose(item.value)}
                >
                  {item.label}
                  <small>{item.value}</small>
                </button>
              ))}
            </div>
            <label>
              自定义英文
              <input
                aria-label="自定义追踪对象"
                value={draft}
                maxLength={160}
                placeholder="例如 right hand with white sleeve"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (validReferenceSubject(draft.trim()))
                      choose(draft.trim());
                    else
                      setError(
                        "请填写英文名称，可包含空格、数字、连字符和单引号。",
                      );
                  }
                }}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => choose("")}>
                清除目标
              </button>
              <button
                type="button"
                className="board-primary"
                onClick={() => {
                  const next = draft.trim();
                  if (!validReferenceSubject(next)) {
                    setError(
                      "请填写英文名称，可包含空格、数字、连字符和单引号。",
                    );
                    return;
                  }
                  choose(next);
                }}
              >
                保存
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
