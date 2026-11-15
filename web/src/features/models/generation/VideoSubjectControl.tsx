import { useId, useRef, useState } from "react";
import { Crosshair, Plus, X } from "lucide-react";
import "./video-subject-control.css";

const splitSubjects = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const validSubject = (value: string) =>
  /^[A-Za-z0-9 '-]+$/.test(value) && /[A-Za-z]/.test(value);

export function VideoSubjectControl({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [state, setState] = useState(() => ({
    value,
    tags: splitSubjects(value),
    draft: "",
    error: "",
  }));
  // A different node or restored draft replaces the whole controlled value.
  if (value !== state.value) {
    setState({ value, tags: splitSubjects(value), draft: "", error: "" });
  }
  const publish = (tags: string[], draft: string, error = "") => {
    const next = [...tags, ...(draft ? [draft] : [])].join(", ");
    setState({ value: next, tags, draft, error });
    if (next !== value) onChange(next);
  };
  const commit = (draft = state.draft) => {
    const subjects = splitSubjects(draft);
    if (subjects.some((subject) => !validSubject(subject))) {
      publish(state.tags, draft, "请使用英文名称，如 person 或 hand。");
      return;
    }
    publish([...new Set([...state.tags, ...subjects])], "");
  };
  const remove = (tag: string) => {
    publish(
      state.tags.filter((item) => item !== tag),
      state.draft,
    );
    inputRef.current?.focus();
  };

  return (
    <section
      className="video-subject-control"
      aria-labelledby={`${id}-label`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        commit();
        onBlur?.();
      }}
    >
      <div className="video-subject-heading">
        <Crosshair aria-hidden="true" />
        <label id={`${id}-label`} htmlFor={id}>
          追踪对象
        </label>
        <span className="video-subject-optional">可选</span>
      </div>
      <div className="video-subject-field" data-invalid={Boolean(state.error)}>
        <ul className="video-subject-tags" aria-label="已添加的追踪对象">
          {state.tags.map((tag) => (
            <li className="video-subject-tag" key={tag}>
              <span>{tag}</span>
              <button
                type="button"
                aria-label={`移除 ${tag}`}
                onClick={() => remove(tag)}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={state.draft}
          placeholder={state.tags.length ? "添加对象…" : "添加对象，如 person…"}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(state.error)}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const draft = event.target.value;
            if (!composing.current && /[,，\n]/.test(draft)) commit(draft);
            else publish(state.tags, draft);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            if (/[,，\n]/.test(event.currentTarget.value))
              commit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (
              event.key === "Enter" ||
              event.key === "," ||
              event.key === "，"
            ) {
              event.preventDefault();
              commit();
            } else if (
              event.key === "Backspace" &&
              !state.draft &&
              state.tags.length
            ) {
              event.preventDefault();
              remove(state.tags[state.tags.length - 1]);
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text/plain");
            if (!/[,，\n]/.test(text)) return;
            event.preventDefault();
            const input = event.currentTarget;
            commit(
              state.draft.slice(0, input.selectionStart ?? 0) +
                text +
                state.draft.slice(input.selectionEnd ?? state.draft.length),
            );
          }}
        />
        <button
          className="video-subject-add"
          type="button"
          aria-label="添加追踪对象"
          disabled={!state.draft.trim()}
          onClick={() => {
            commit();
            inputRef.current?.focus();
          }}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      <p
        id={`${id}-hint`}
        className="video-subject-hint"
        role={state.error ? "alert" : undefined}
      >
        {state.error || "输入英文名称，按 Enter 或逗号添加多个对象"}
      </p>
    </section>
  );
}
