import { useEffect, useState } from "react";
import {
  formatTimecode,
  parseTimecode,
} from "@features/galgame-workshop/editor/timeline";

export function VideoClipTimecodeInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatTimecode(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(formatTimecode(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) return setInvalid(true);
    setInvalid(false);
    onCommit(parsed);
  };
  return (
    <label className={invalid ? "invalid" : ""}>
      <span>{label}</span>
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={draft}
        placeholder="00:00.000"
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(formatTimecode(value));
            setInvalid(false);
          }
        }}
      />
      {invalid ? <small>请输入如 01:23.456 的时间码</small> : null}
    </label>
  );
}
