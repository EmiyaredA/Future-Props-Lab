import type { Mode } from "@features/creative-workshop/shared";

type CreativeRoute = { mode: Mode; itemId?: string };

export function creativeRoute(pathname: string): CreativeRoute | null {
  const path = pathname.replace(/\/$/, "");
  if (path === "/creative-workshop") return { mode: "creative-workshop" };
  if (path === "/creative-workshop/mine")
    return { mode: "creative-workshop-mine" };
  if (path === "/creative-workshop/new")
    return { mode: "creative-workshop-new" };
  const match = /^\/creative-workshop\/(edit|item)\/([^/]+)$/.exec(path);
  if (!match) return null;
  try {
    return {
      mode:
        match[1] === "edit"
          ? "creative-workshop-editor"
          : "creative-workshop-detail",
      itemId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

export function creativePath(mode: Mode, id?: string): string {
  if (mode === "creative-workshop-mine") return "/creative-workshop/mine";
  if (mode === "creative-workshop-new") return "/creative-workshop/new";
  if (mode === "creative-workshop-editor")
    return id
      ? "/creative-workshop/edit/" + encodeURIComponent(id)
      : "/creative-workshop/mine";
  if (mode === "creative-workshop-detail")
    return id
      ? "/creative-workshop/item/" + encodeURIComponent(id)
      : "/creative-workshop";
  return "/creative-workshop";
}
