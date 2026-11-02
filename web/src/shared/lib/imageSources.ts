import { imageVariants } from "./imageVariants";

export type ImageSize = 128 | 320 | 640 | 1280;
export function imagePreviewSource(
  source: string,
  size: ImageSize = 640,
): string {
  if (!source.startsWith("/v1/")) return source;
  const [pathname, query = ""] = source.split("?");
  const url = { pathname: pathname!, searchParams: new URLSearchParams(query) };
  if (/^\/v1\/files\/[^/]+\/(content|download)$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(content|download)$/, "/thumbnail");
  } else if (
    !/^\/v1\/files\/[^/]+\/thumbnail$/.test(url.pathname) &&
    !/^\/v1\/model-test\/(generation-tasks\/[^/]+|conversations\/[^/]+\/attachments\/[^/]+)\/content$/.test(
      url.pathname,
    ) &&
    !/^\/v1\/account\/profile\/avatar$/.test(url.pathname) &&
    !/^\/v1\/thought-workshop\/community\/publications\/[^/]+\/(cover|assets\/[^/]+\/content)$/.test(
      url.pathname,
    ) &&
    !/^\/v1\/creative-workshop\/(items|releases)\/[^/]+\/cover$/.test(
      url.pathname,
    )
  )
    return source;
  url.searchParams.set("size", String(size));
  return url.pathname + "?" + url.searchParams.toString();
}

export function publicImageSources(source: string, width = 64) {
  const variants = imageVariants[source];
  if (!variants) return { src: source };
  const sizes = Object.keys(variants)
    .map(Number)
    .sort((a, b) => a - b);
  const chosen = sizes.find((size) => size >= width) ?? sizes.at(-1)!;
  return {
    src: variants[String(chosen)],
    srcSet: sizes
      .map((size) => `${variants[String(size)]} ${size}w`)
      .join(", "),
    sizes: `${width}px`,
  };
}
