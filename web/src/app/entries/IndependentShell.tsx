import { NavigationProtection } from "@shared/ui/NavigationProtection";
import type { ReactNode, MouseEvent } from "react";
import { AccountMenu } from "@features/accounts/AccountMenu";
import { AccountPanel } from "@features/accounts/AccountPanel";
import { useStudioSession } from "@app/StudioSession";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { BrandMark } from "@shared/ui/BrandMark";

import { useAccountPermission } from "@platform/auth/AccountAccess";
import { guardedNavigation } from "./navigation";

export function IndependentShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const session = useStudioSession();
  const canUseCloudControl = useAccountPermission("cloud-control.access");
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const target = event.currentTarget.href;
    event.preventDefault();
    guardedNavigation(() => window.location.assign(target), true);
  };
  return (
    <NavigationProtection>
      <div className="independent-app">
        <header className="independent-header">
          <a
            href="/"
            onClick={follow}
            className="independent-brand"
            aria-label="Future Props Lab 首页"
          >
            <BrandMark size={30} />
            <span>{title}</span>
          </a>
          <nav aria-label="应用导航">
            <a href="/apps" onClick={follow}>
              应用目录
            </a>
            {canUseCloudControl && (
              <a href="/cloud-control" onClick={follow}>
                云控
              </a>
            )}
            <a href="/docs.html" onClick={follow}>
              文档
            </a>
          </nav>
          <div className="independent-account">
            <ThemeToggle compact />
            <AccountMenu session={session} />
          </div>
        </header>
        <ApplicationUpdate />
        <main className="independent-content">{children}</main>
        <AccountPanel session={session} hiddenEntries />
      </div>
    </NavigationProtection>
  );
}
