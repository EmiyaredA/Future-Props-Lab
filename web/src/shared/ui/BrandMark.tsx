import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <ResponsiveImage
      className="brand-mark"
      loading="eager"
      fetchPriority="high"
      width={size}
      height={size}
      src="/brand/brand-mark.png"
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
