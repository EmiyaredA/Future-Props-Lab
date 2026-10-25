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
  const pages = [...unions.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map(
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
      "creative-workshop-detail",
      "creative-workshop-editor",
      "director-desk-editor",
      "desktop-pet-editor",
      "galgame-workshop-editor",
      "galgame-workshop-overview",
      "galgame-workshop-preview",
      "live2d-workshop-editor",
      "motion-compositor-editor",
      "presentation-workshop-editor",
      "presentation-workshop-templates",
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
  expect(html.sort()).toEqual([
    "amadeus.html",
    "docs.html",
    "index.html",
    "pet-chat.html",
    "pet.html",
  ]);
  expect(publicSurfaces).toEqual([
    "login",
    "account-workspace",
    "public-workspace",
    "docs",
  ]);
});
