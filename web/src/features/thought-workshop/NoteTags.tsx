import { useEffect, useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";

function TagInput({
  tags,
  finish,
}: {
  tags: string[];
  finish: (tags?: string[], restoreFocus?: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const keyboardFinish = useRef(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <input
      ref={input}
      className="thought-tags-input"
      aria-label="笔记标签"
      placeholder="添加标签，以逗号分隔"
      defaultValue={tags.join(", ")}
      onBlur={(event) => {
        if (!cancelled.current)
          finish(
            [
              ...new Set(
                event.target.value
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              ),
            ],
            keyboardFinish.current,
          );
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          finish(undefined, true);
        } else if (
          event.key === "Enter" ||
          ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s")
        ) {
          event.preventDefault();
          keyboardFinish.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function NoteTags({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="thought-note-tags" aria-label="笔记标签列表">
      {editing ? (
        <TagInput
          key={JSON.stringify(tags)}
          tags={tags}
          finish={(next, restoreFocus) => {
            if (next && JSON.stringify(next) !== JSON.stringify(tags))
              onChange(next);
            setEditing(false);
            if (restoreFocus) {
              requestAnimationFrame(() => trigger.current?.focus());
            }
          }}
        />
      ) : (
        <>
          {tags.map((tag) => (
            <span className="thought-tag" key={tag}>
              {tag}
            </span>
          ))}
          <button
            ref={trigger}
            type="button"
            aria-label="编辑标签"
            onClick={() => setEditing(true)}
          >
            {tags.length ? (
              <Pencil size={13} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            {tags.length ? "编辑标签" : "添加标签"}
          </button>
        </>
      )}
    </div>
  );
}
