import { useCallback, useEffect, useRef } from "react";
import {
  IntegrationCenterPage,
  type IntegrationKind,
} from "@features/integrations/IntegrationCenterPage";
import type { NavigationGuard } from "@features/integrations/interaction";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { useNavigationProtection } from "@shared/ui/navigationGuards";
import { IndependentShell } from "./IndependentShell";
import { guardedNavigation } from "./navigation";

const kinds = ["tool-apis", "mcp", "skills", "external-connections"] as const;

function IntegrationsContent() {
  const canManage = useAccountPermission("configuration.manage");
  const protection = useNavigationProtection();
  const unregister = useRef<(() => void) | null>(null);
  const registerNavigationGuard = useCallback(
    (guard: NavigationGuard | null) => {
      unregister.current?.();
      unregister.current =
        guard && protection ? protection.register(guard) : null;
    },
    [protection],
  );
  useEffect(() => () => unregister.current?.(), []);
  const path = location.pathname.replace(/\/$/, "");
  const part =
    path === "/integrations"
      ? "tool-apis"
      : path.slice("/integrations/".length);
  if (!kinds.includes(part as IntegrationKind))
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/integrations">返回集成中心</a>
      </section>
    );
  return (
    <IntegrationCenterPage
      kind={part as IntegrationKind}
      canManage={canManage}
      registerNavigationGuard={registerNavigationGuard}
      onKindChange={(kind) =>
        guardedNavigation(() => location.assign("/integrations/" + kind), true)
      }
    />
  );
}

export default function IntegrationsApplication() {
  return (
    <IndependentShell title="集成中心">
      <IntegrationsContent />
    </IndependentShell>
  );
}
