import type { Plugin } from "vite";
import { imageVariants } from "./src/shared/lib/imageVariants";

export function resolveApplicationIcon(html: string): string {
  return html.replace(/<link\b[^>]*\brel=["']icon["'][^>]*>/g, (tag) => {
    const href = tag.match(/\bhref=["'](%BASE_URL%|\/)([^"']+)["']/);
    if (!href) return tag;
    const small = imageVariants["/" + href[2]]?.["64"];
    if (!small) return tag;
    return tag
      .replace(/\bhref=["'][^"']+["']/, `href="${href[1]}${small.slice(1)}"`)
      .replace(/\btype=["'][^"']+["']/, 'type="image/webp"');
  });
}

export function applicationIcons(): Plugin {
  return {
    name: "application-avatar-icons",
    transformIndexHtml: { order: "pre", handler: resolveApplicationIcon },
  };
}
