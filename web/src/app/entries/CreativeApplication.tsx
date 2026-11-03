import { useAccountPermission } from "@platform/auth/AccountAccess";
import { CreativeWorkshopPage } from "@features/creative-workshop/CreativeWorkshopPage";
import { IndependentShell } from "./IndependentShell";
import { creativePath, creativeRoute } from "./creativeRoutes";
import { guardedNavigation } from "./navigation";

function CreativeContent() {
  const canWrite = useAccountPermission("content.write");
  const canInstall = useAccountPermission("configuration.manage");
  const route = creativeRoute(window.location.pathname);
  if (!route)
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/creative-workshop">返回创意工坊</a>
      </section>
    );
  return (
    <CreativeWorkshopPage
      mode={route.mode}
      itemId={route.itemId}
      canWrite={canWrite}
      canInstall={canInstall}
      navigate={(mode, id) =>
        guardedNavigation(
          () => window.location.assign(creativePath(mode, id)),
          true,
        )
      }
    />
  );
}

export default function CreativeApplication() {
  return (
    <IndependentShell title="创意工坊">
      <CreativeContent />
    </IndependentShell>
  );
}
