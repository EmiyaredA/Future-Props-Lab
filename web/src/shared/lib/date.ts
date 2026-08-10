export function relativeTime(value: string, suffix = "更新"): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return suffix ? `刚刚${suffix}` : "刚刚";
  if (elapsed < 3_600_000)
    return `${Math.floor(elapsed / 60_000)} 分钟前${suffix}`;
  if (elapsed < 86_400_000)
    return `${Math.floor(elapsed / 3_600_000)} 小时前${suffix}`;
  if (elapsed < 604_800_000)
    return `${Math.floor(elapsed / 86_400_000)} 天前${suffix}`;
  const date = new Date(value).toLocaleDateString("zh-CN");
  return suffix ? `${date} ${suffix}` : date;
}
