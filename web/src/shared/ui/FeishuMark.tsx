/** Feishu client brand mark; source: flathub/cn.feishu.Feishu. */
export function FeishuMark({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/providers/feishu-logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      style={{ flexShrink: 0, borderRadius: size / 4 }}
    />
  );
}
