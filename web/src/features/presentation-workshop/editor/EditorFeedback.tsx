import type { PresentationSession } from "./usePresentationSession";
export function EditorFeedback({
  session,
  onOpen,
}: {
  session: PresentationSession;
  onOpen: (id: string) => void;
}) {
  const { error, draft, report, setTitleDraft, select, setEditing } = session;
  return (
    <>
      {" "}
      {error || draft.error ? (
        <div className="presentation-error" role="alert">
          {error || draft.error}
          {draft.state === "error" ? (
            <button
              className="btn"
              onClick={() =>
                void report(async () => {
                  await draft.flush();
                })
              }
            >
              重试保存
            </button>
          ) : null}
        </div>
      ) : null}
      {draft.state === "conflict" ? (
        <div className="presentation-conflict">
          文稿已在其他窗口更新，本地修改仍保留。
          <button
            className="btn"
            disabled={!draft.conflict}
            onClick={() => {
              if (draft.conflict) {
                draft.adopt(draft.conflict);
                setTitleDraft(null);
                select([]);
                setEditing(null);
              }
            }}
          >
            加载服务器版本
          </button>
          <button
            className="btn"
            onClick={() =>
              void report(async () => {
                const copy = await draft.duplicate();
                draft.adopt(copy);
                onOpen(copy.id);
              })
            }
          >
            另存为副本
          </button>
        </div>
      ) : null}
    </>
  );
}
