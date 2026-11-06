import { afterEach, expect, test, vi } from "vitest";
import { publicImageSources } from "@shared/lib/imageSources";

afterEach(() => vi.unstubAllEnvs());

test("maps only the current service program to its owned responsive variants", () => {
  const prefix = "/_apps/portal/0123456789abcdef0123/";
  vi.stubEnv("BASE_URL", prefix);
  const root = publicImageSources("/brand/thought-workshop-mark.png", 64);
  expect(root.src).toMatch(
    /^\/_apps\/portal\/0123456789abcdef0123\/brand\/thumbnails\//,
  );
  expect(root.srcSet).toContain(prefix);
  expect(
    publicImageSources(prefix + "brand/thought-workshop-mark.png", 64),
  ).toEqual(root);
  expect(publicImageSources("/providers/openai.svg").src).toBe(
    prefix + "providers/openai.svg",
  );
  for (const privateOrForeign of [
    "/v1/files/owned/content",
    "blob:http://example.test/token",
    "https://example.test/brand/portrait.png",
    "/_apps/agents/different/brand/thought-workshop-mark.png",
  ])
    expect(publicImageSources(privateOrForeign)).toEqual({
      src: privateOrForeign,
    });
});

test("preserves root program paths in the legacy recovery build", () => {
  vi.stubEnv("BASE_URL", "/");
  expect(publicImageSources("/providers/openai.svg")).toEqual({
    src: "/providers/openai.svg",
  });
});
