import "./studio-global-header.css";
import { BookOpen } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { useOptionalStudioSession } from "@app/StudioSession";
import { AccountMenu } from "@features/accounts/AccountMenu";
import { AccountPanel } from "@features/accounts";
import { DesktopAppChrome } from "@app/layout/DesktopAppChrome";

export function StudioGlobalHeader() {
  const session = useOptionalStudioSession();
  return (
    <header className="studio-panel studio-global-header">
      <div className="studio-header-start">
        <div className="studio-header-theme">
          <span>外观</span>
          <ThemeToggle />
        </div>
      </div>
      <div className="studio-header-actions">
        <DesktopAppChrome />
        <a
          className="studio-docs-link"
          href="/docs.html"
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={18} />
          <span>文档中心</span>
        </a>
        {session ? (
          <>
            <AccountMenu session={session} />
            <AccountPanel session={session} hiddenEntries />
          </>
        ) : null}
      </div>
    </header>
  );
}
