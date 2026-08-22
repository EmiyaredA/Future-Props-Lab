export function StoryConflictBanner({
  open,
  onLoadServer,
  onOverwrite,
}: {
  open: boolean;
  onLoadServer: () => void;
  onOverwrite: () => void;
}) {
  if (!open) return null;
  return (
    <div className="galgame-conflict" role="alert">
      <span>
        <strong>故事存在更新冲突</strong>
        本地草稿仍保留，请选择要使用的版本。
      </span>
      <button type="button" onClick={onLoadServer}>
        载入服务器版本
      </button>
      <button type="button" className="danger" onClick={onOverwrite}>
        用本地版本覆盖
      </button>
    </div>
  );
}
