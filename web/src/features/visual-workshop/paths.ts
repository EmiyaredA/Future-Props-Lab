export function visualWorkshopPath(page: string, projectId?: string) {
  if (page === "visual-workshop-canvas" && projectId)
    return `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/canvas`;
  if (page === "visual-workshop-assets")
    return projectId
      ? `/apps/visual-workshop/projects/${encodeURIComponent(projectId)}/assets`
      : "/apps/visual-workshop/assets";
  if (page === "visual-workshop-tasks") return "/apps/visual-workshop/tasks";
  if (page === "visual-workshop-card-library")
    return "/apps/visual-workshop/card-library";
  if (page === "visual-workshop-projects") return "/apps/visual-workshop";
  return undefined;
}
