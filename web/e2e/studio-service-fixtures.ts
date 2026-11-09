import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

export const restoredStudioPages = [
  ["/tools", "tools", "工具导航"],
  ["/integrations/tool-apis", "integrations", "集成中心"],
  ["/model-service", "models", "模型与智能体"],
  ["/code-agents", "agent-runtime", "模型与智能体"],
  ["/creative-workshop", "creative", "创意工坊"],
] as const;

export async function mountIndependentPrograms(page: Page, baseURL: string) {
  const origins = new URL(baseURL).origin;
  const programs = process.env.FPL_E2E_SERVICE_RELEASES;
  const releases: Record<string, { root: string; build: string }> = programs
    ? JSON.parse(readFileSync(programs, "utf8"))
    : {};
  await page.route(
    (url) => url.origin === origins,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const asset = /^\/_apps\/([a-z-]+)\/([a-f0-9]{20})\/(.+)$/.exec(path);
      if (asset && releases[asset[1]]?.build === asset[2]) {
        const root = releases[asset[1]].root;
        const file = resolve(root, asset[3]);
        if (!file.startsWith(root + "/")) return route.abort();
        return route.fulfill({ path: file });
      }
      if (!route.request().isNavigationRequest()) return route.fallback();
      const service =
        restoredStudioPages.find(
          ([entry]) => path === entry || path.startsWith(entry + "/"),
        )?.[1] ??
        (path === "/integrations" || path.startsWith("/integrations/")
          ? "integrations"
          : ["/model-test", "/model-call-logs"].includes(path)
            ? "models"
            : undefined);
      if (!service) return route.fallback();
      if (releases[service]) {
        return route.fulfill({
          path: resolve(releases[service].root, service + ".html"),
        });
      }
      const response = await route.fetch({
        url: new URL(service + ".html", baseURL).href,
      });
      return route.fulfill({ response });
    },
  );
}
