export function ActionIcon({
  kind,
}: {
  kind: "edit" | "delete" | "key" | "revision";
}) {
  const paths = {
    edit: (
      <path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5ZM13 7.5l3.5 3.5M15.5 5l1.2-1.2a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L19 8.5" />
    ),
    delete: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
    key: (
      <path d="M14 9a5 5 0 1 1-1.4-3.5A5 5 0 0 1 14 9Zm0 0h7m-3 0v3m-3-3v2" />
    ),
    revision: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2" />,
  };
  return (
    <svg className="ui-action-icon" viewBox="0 0 24 24" aria-hidden>
      {paths[kind]}
    </svg>
  );
}

export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={on ? "已启用" : "未启用"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span />
    </button>
  );
}
