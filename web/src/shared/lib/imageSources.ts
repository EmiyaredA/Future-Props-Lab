import { programAsset } from "@platform/programAsset";
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
  const base = import.meta.env.BASE_URL;
  const canonical =
    base !== "/" && source.startsWith(base)
      ? "/" + source.slice(base.length)
      : source;
  const owned = /^\/(brand|providers|presentation-templates)\//.test(canonical);
  const resource = (value: string | undefined) =>
    value && owned ? programAsset(value) : value;
  const variants = imageVariants[canonical];
  if (!variants) return { src: owned ? resource(canonical) : source };
  const sizes = Object.keys(variants)
    .map(Number)
    .sort((a, b) => a - b);
  const chosen = sizes.find((size) => size >= width) ?? sizes.at(-1)!;
  return {
    src: resource(variants[String(chosen)]),
    srcSet: sizes
      .map((size) => `${resource(variants[String(size)])} ${size}w`)
      .join(", "),
    sizes: `${width}px`,
  };
}
