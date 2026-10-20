import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { paintStyle, type Paint } from "./paintStyle";
export function PaintLayer({
  paint,
  assetUrls,
}: {
  paint: Paint;
  assetUrls?: Record<string, string>;
}) {
  const override = paint.asset_id ? assetUrls?.[paint.asset_id] : undefined;
  const asset = useApiBlobUrl(
    paint.asset_id && !override
      ? `/v1/files/${encodeURIComponent(paint.asset_id)}/content`
      : null,
  );
  return (
    <div
      className="presentation-paint"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        ...paintStyle(paint, override ?? asset.url),
      }}
    >
      {paint.type === "image" && !override && !asset.url && (
        <span className="presentation-image-status" role="status">
          {asset.error ? "图片加载失败" : "加载图片…"}
        </span>
      )}
    </div>
  );
}
