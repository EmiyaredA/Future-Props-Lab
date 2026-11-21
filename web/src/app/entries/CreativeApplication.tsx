import { useAccountPermission } from "@platform/auth/AccountAccess";
import { CreativeWorkshopPage } from "@features/creative-workshop/CreativeWorkshopPage";
import { StudioServiceShell } from "./StudioServiceShell";
import { creativePath, creativeRoute } from "./creativeRoutes";
import { useApplicationLocation } from "@app/routing/applicationNavigationContext";

const roots = ["/creative-workshop"];

function CreativeContent() {
  const canWrite = useAccountPermission("content.write");
  const canInstall = useAccountPermission("configuration.manage");
  const { path, navigate } = useApplicationLocation();
  const route = creativeRoute(new URL(path, location.origin).pathname);
  if (!route)
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/creative-workshop">返回创意工坊</a>
      </section>
    );
  return (
    <CreativeWorkshopPage
      key={`${route.mode}:${route.itemId ?? "index"}`}
      mode={route.mode}
      itemId={route.itemId}
      canWrite={canWrite}
      canInstall={canInstall}
      navigate={(mode, id) => navigate(creativePath(mode, id))}
    />
  );
}

export default function CreativeApplication() {
  return (
    <StudioServiceShell title="创意工坊" roots={roots}>
      <CreativeContent />
    </StudioServiceShell>
  );
}
