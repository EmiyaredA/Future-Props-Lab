import { readFileSync } from "node:fs";
import { parseRoute } from "@app/routes";
import {
  responsiveOwners,
  staticPaths,
  publicSurfaces,
} from "../e2e/responsive-inventory";

test("every route and independent HTML entry has a responsive scenario", () => {
  const source = readFileSync("src/app/routes.ts", "utf8");
  const unions = source.slice(
    0,
    source.indexOf("export type VisualWorkshopPage"),
  );
  const pages = [...unions.matchAll(/\|\s*"([a-z-]+)"/g)].map(
    (match) => match[1],
  );
  expect(Object.keys(responsiveOwners).sort()).toEqual(pages.sort());
  expect(
    new Set(staticPaths.map((path) => parseRoute(path).page)).size,
  ).toBeGreaterThan(15);
  const covered = new Set(staticPaths.map((path) => parseRoute(path).page));
  expect(
    Object.keys(responsiveOwners)
      .filter((page) => !covered.has(page as keyof typeof responsiveOwners))
      .sort(),
  ).toEqual(
    [
      "audio-annotation-editor",
      "director-desk-editor",
      "galgame-workshop-editor",
      "galgame-workshop-overview",
      "galgame-workshop-preview",
      "presentation-workshop-editor",
      "thought-workshop-editor",
      "thought-workshop-legacy",
      "video-editor-editor",
      "visual-workshop-assets",
      "visual-workshop-canvas",
    ].sort(),
  );
  const build = readFileSync("vite.config.ts", "utf8");
  const html = [
    ...build.matchAll(/resolve\(__dirname, "([^"]+\.html)"\)/g),
  ].map((match) => match[1]);
  expect(html.sort()).toEqual(["docs.html", "index.html"]);
  expect(publicSurfaces).toEqual([
    "login",
    "account-workspace",
    "public-workspace",
    "docs",
  ]);
});
