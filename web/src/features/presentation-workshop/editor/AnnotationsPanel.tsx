import { useState } from "react";
import { newId } from "../templates";
import type { Slide } from "../types";
export function AnnotationsPanel({
  slide,
  selected,
  readOnly,
  change,
}: {
  slide: Slide;
  selected: string[];
  readOnly: boolean;
  change: (slide: Slide) => void;
}) {
  const [text, setText] = useState(""),
    [replies, setReplies] = useState<Record<string, string>>({});
  const annotations = slide.annotations ?? [];
  return (
    <section aria-label="页面批注">
      {!readOnly && (
        <>
          <textarea
            aria-label="新批注"
            maxLength={20000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="btn"
            disabled={!text.trim() || annotations.length >= 200}
            onClick={() => {
              change({
                ...slide,
                annotations: [
                  ...annotations,
                  {
                    id: newId(),
                    text: text.trim(),
                    element_id: selected.length === 1 ? selected[0] : null,
                    replies: [],
                    resolved: false,
                  },
                ],
              });
              setText("");
            }}
          >
            添加批注
          </button>
        </>
      )}
      {annotations.map((annotation) => (
        <article key={annotation.id} className="presentation-annotation">
          <p>
            {annotation.resolved ? "✓ 已解决 · " : ""}
            {annotation.text}
          </p>
          <ol>
            {(annotation.replies ?? []).map((reply) => (
              <li key={reply.id}>{reply.text}</li>
            ))}
          </ol>
          {!readOnly && (
            <>
              <input
                aria-label={`回复批注 ${annotation.id}`}
                value={replies[annotation.id] ?? ""}
                maxLength={20000}
                onChange={(e) =>
                  setReplies({ ...replies, [annotation.id]: e.target.value })
                }
              />
              <button
                className="btn"
                disabled={
                  !replies[annotation.id]?.trim() ||
                  (annotation.replies ?? []).length >= 100
                }
                onClick={() => {
                  change({
                    ...slide,
                    annotations: annotations.map((a) =>
                      a.id === annotation.id
                        ? {
                            ...a,
                            replies: [
                              ...(a.replies ?? []),
                              { id: newId(), text: replies[a.id].trim() },
                            ],
                          }
                        : a,
                    ),
                  });
                  setReplies({ ...replies, [annotation.id]: "" });
                }}
              >
                回复
              </button>
              <button
                className="btn"
                onClick={() =>
                  change({
                    ...slide,
                    annotations: annotations.map((a) =>
                      a.id === annotation.id
                        ? { ...a, resolved: !a.resolved }
                        : a,
                    ),
                  })
                }
              >
                {annotation.resolved ? "重新打开" : "解决批注"}
              </button>
              <button
                className="btn"
                onClick={() =>
                  change({
                    ...slide,
                    annotations: annotations.filter(
                      (a) => a.id !== annotation.id,
                    ),
                  })
                }
              >
                删除批注
              </button>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
