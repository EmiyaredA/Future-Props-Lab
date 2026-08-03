import type { StudioPage } from "@app/layout/StudioSidebar";

export function parsePage(pathname = window.location.pathname): StudioPage {
  if (pathname.startsWith("/tools")) return "tools";
  if (pathname.startsWith("/model-test")) return "model-test";
  if (pathname.startsWith("/model-call-logs")) return "model-call-logs";
  return pathname.startsWith("/model-service") ? "model-service" : "tools";
}

export function pathFor(page: StudioPage): string {
  if (page === "tools") return "/tools";
  if (page === "model-test") return "/model-test";
  return page === "model-call-logs" ? "/model-call-logs" : "/model-service";
}
