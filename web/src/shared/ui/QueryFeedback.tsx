export function QueryFeedback({
  error,
  pending,
  onRetry,
}: {
  error: Error | null;
  pending?: boolean;
  onRetry: () => unknown;
}) {
  if (error)
    return (
      <div className="inline-alert danger" role="alert">
        <span>加载失败：{error.message}</span>
        <button
          className="btn"
          onClick={() => {
            void onRetry();
          }}
        >
          重试
        </button>
      </div>
    );
  return pending ? <p role="status">正在加载…</p> : null;
}
