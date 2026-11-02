import { ImagePreview } from "@shared/ui/ImagePreview";
import type { CreativeItem } from "./api";

export function Cover({
  item,
}: {
  item: Pick<CreativeItem, "kind" | "cover_preset" | "cover_url">;
}) {
  return (
    <div className={`creative-cover creative-cover--${item.cover_preset}`}>
      {item.cover_url ? (
        <ImagePreview
          interactive={false}
          src={item.cover_url}
          size={640}
          alt=""
        />
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
