import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import { imageVariants } from "@shared/lib/imageVariants";
import { resolveApplicationIcon } from "../../applicationIcons";

test("every workshop declares its own packaged avatar as a small browser icon", () => {
  const selected = new Set<string>();
  for (const application of APPLICATION_DEFINITIONS) {
    const html = readFileSync(
      resolve(__dirname, "../../", application.serviceId + ".html"),
      "utf8",
    );
    const transformed = resolveApplicationIcon(html);
    const document = new DOMParser().parseFromString(transformed, "text/html");
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    const variant = imageVariants[application.brandImage]["64"];
    expect(icon.getAttribute("href")).toBe("%BASE_URL%" + variant.slice(1));
    expect(icon.type).toBe("image/webp");
    const resource = readFileSync(
      resolve(__dirname, "../../public", variant.slice(1)),
    );
    expect(resource.subarray(0, 4).toString()).toBe("RIFF");
    expect(resource.byteLength).toBeLessThan(20_000);
    selected.add(variant);
  }
  expect(selected.size).toBe(APPLICATION_DEFINITIONS.length);
});

test("the icon transform preserves production prefixes and unrelated external links", () => {
  const external =
    '<link rel="icon" type="image/png" href="https://example.test/icon.png">';
  expect(resolveApplicationIcon(external)).toBe(external);
  const own =
    '<link rel="icon" type="image/png" href="/brand/video-editor-mark.png">';
  expect(resolveApplicationIcon(own)).toContain(
    'href="/brand/thumbnails/video-editor-mark-',
  );
});
