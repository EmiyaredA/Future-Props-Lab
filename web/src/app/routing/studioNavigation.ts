import type { StudioPage } from "@app/routes";

export const studioPaths = {
  home: "/home",
  "creative-workshop": "/creative-workshop",
  "creative-workshop-mine": "/creative-workshop/mine",
  "creative-workshop-new": "/creative-workshop/new",
  apps: "/apps",
  "cloud-control": "/cloud-control",
  amadeus: "/amadeus",
  files: "/files",
  tools: "/tools",
  "integrations-tool-apis": "/integrations/tool-apis",
  "integrations-mcp": "/integrations/mcp",
  "integrations-skills": "/integrations/skills",
  "integrations-external-connections": "/integrations/external-connections",
  "video-frame-exporter": "/tools/video-frame-exporter",
  "video-downloader": "/tools/video-downloader",
  "model-test": "/model-test",
  "code-agents": "/code-agents",
  "model-service": "/model-service",
  "model-call-logs": "/model-call-logs",
  "creative-workshop-editor": "/creative-workshop/mine",
  "creative-workshop-detail": "/creative-workshop",
  "thought-workshop-community": "/apps/thought-workshop/community",
  "thought-workshop-favorites": "/apps/thought-workshop/favorites",
  "thought-workshop-published": "/apps/thought-workshop/published",
} satisfies Record<StudioPage, string>;

export function studioNavigationPage(pathname: string): StudioPage | undefined {
  const path = pathname.replace(/\/+$/, "");
  if (!path) return "home";
  if (path.startsWith("/apps/")) return undefined;
  if (path === "/integrations") return "integrations-tool-apis";
  if (path.startsWith("/creative-workshop/edit/"))
    return "creative-workshop-editor";
  if (path.startsWith("/creative-workshop/item/"))
    return "creative-workshop-detail";
  return (Object.keys(studioPaths) as (keyof typeof studioPaths)[]).find(
    (page) => studioPaths[page] === path,
  );
}
