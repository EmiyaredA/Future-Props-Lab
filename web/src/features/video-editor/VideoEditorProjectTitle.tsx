import { useRef, useState } from "react";

export function VideoEditorProjectTitle({
  title,
  rename,
}: {
  title: string;
  rename: (title: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const discard = useRef(false);
  return (
    <input
      aria-label="项目名称"
      maxLength={120}
      value={draft ?? title}
      onFocus={() => setDraft(title)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (discard.current) {
          discard.current = false;
          setDraft(null);
          return;
        }
        const next = (draft ?? title).trim();
        if (next && next !== title) void rename(next);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          discard.current = true;
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
