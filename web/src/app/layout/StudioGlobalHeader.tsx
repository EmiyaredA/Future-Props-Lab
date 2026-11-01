import "./studio-global-header.css";
import { BookOpen, Sparkles } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { useOptionalStudioSession } from "@app/StudioSession";
import { AccountMenu } from "@features/accounts/AccountMenu";
import { AccountPanel } from "@features/accounts";
import { openAmadeus } from "@platform/assistant";

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
        <button
          type="button"
          className="studio-header-chip"
          aria-label="打开 Amadeus"
          onClick={() => void openAmadeus()}
        >
          <Sparkles size={16} aria-hidden />
          <span>Amadeus</span>
        </button>
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
