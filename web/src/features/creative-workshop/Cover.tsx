import type { CreativeItem } from "./api";

export function Cover({
  item,
}: {
  item: Pick<CreativeItem, "kind" | "cover_preset" | "cover_url">;
}) {
  return (
    <div className={`creative-cover creative-cover--${item.cover_preset}`}>
      {item.cover_url ? (
        <img src={item.cover_url} alt="" />
      ) : (
        <span>
          {item.kind === "bundle"
            ? "✦"
            : item.kind === "tool_api"
              ? "⌘"
              : item.kind === "mcp"
                ? "◈"
                : "✧"}
        </span>
      )}
    </div>
  );
}
