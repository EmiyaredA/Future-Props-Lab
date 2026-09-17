/** Bust browser cache when the same avatar endpoint serves updated bytes. */
export function avatarSrc(
  url: string | null | undefined,
  revision: number,
): string | undefined {
  if (!url) return undefined;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${revision}`;
}
