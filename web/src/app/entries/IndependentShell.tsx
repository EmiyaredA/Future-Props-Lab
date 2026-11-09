import { NavigationProtection } from "@shared/ui/NavigationProtection";
import type { ReactNode, MouseEvent } from "react";
import { AccountMenu } from "@features/accounts/AccountMenu";
import { AccountPanel } from "@features/accounts/AccountPanel";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { useStudioSession } from "@app/StudioSession";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { Button } from "@shared/ui/button";
import { Sparkles } from "lucide-react";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { BrandMark } from "@shared/ui/BrandMark";

import { useAccountPermission } from "@platform/auth/AccountAccess";
import { openAmadeus } from "@platform/assistant";
import { guardedNavigation } from "./navigation";
import {
  studioNavigationPage,
  studioPaths,
} from "@app/routing/studioNavigation";
import { StudioShell } from "@app/layout/StudioSidebar";

export function IndependentShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const session = useStudioSession();
  const canUseCloudControl = useAccountPermission("cloud-control.access");
  const canRead = useAccountPermission("content.read");
  const page = studioNavigationPage(window.location.pathname);
  const assistant = () => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: title,
          path: location.pathname,
          title: document.title,
        },
      }),
    );
    void openAmadeus();
  };
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
  const shell = (
    <NavigationProtection>
      {page ? (
        <StudioShell
          page={page}
          navigate={(target) =>
            guardedNavigation(
              () => window.location.assign(studioPaths[target]),
              true,
            )
          }
          assistant={assistant}
        >
          <ApplicationUpdate />
          {children}
        </StudioShell>
      ) : (
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
              {canRead && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="independent-assistant"
                  aria-label="打开 Amadeus"
                  onClick={assistant}
                >
                  <Sparkles size={16} aria-hidden />
                  <span>Amadeus</span>
                </Button>
              )}
              <ThemeToggle compact />
              <AccountMenu session={session} />
            </div>
          </header>
          <ApplicationUpdate />
          <main className="independent-content">{children}</main>
          <AccountPanel session={session} hiddenEntries />
        </div>
      )}
    </NavigationProtection>
  );
  return canRead ? (
    <AmadeusPageProvider key={session.me.user.id} session={session}>
      {shell}
    </AmadeusPageProvider>
  ) : (
    shell
  );
}
