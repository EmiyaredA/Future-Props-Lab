import { programAsset } from "@platform/programAsset";

export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      width={size}
      height={size}
      src={programAsset("/brand/brand-mark.png")}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
