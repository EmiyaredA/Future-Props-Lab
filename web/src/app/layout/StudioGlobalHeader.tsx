import "./studio-global-header.css";
import { BookOpen, Sparkles } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { useOptionalStudioSession } from "@app/StudioSession";
import { AccountMenu } from "@features/accounts/AccountMenu";
import { AccountPanel } from "@features/accounts";
import { openAmadeus } from "@platform/assistant";
import { useAccountPermission } from "@platform/auth/AccountAccess";

export function StudioGlobalHeader({
  assistant = openAmadeus,
}: {
  assistant?: (() => void) | null;
}) {
  return (
    <header className="studio-panel studio-global-header">
      <div className="studio-header-start">
        <div className="studio-header-theme">
          <span>外观</span>
          <ThemeToggle />
        </div>
      </div>
      <StudioHeaderActions assistant={assistant} />
    </header>
  );
}

function StudioHeaderActions({
  assistant,
}: {
  assistant: (() => void) | null;
}) {
  const session = useOptionalStudioSession();
  const canRead = useAccountPermission("content.read");
  return (
    <div className="studio-header-actions">
      {assistant && canRead && (
        <button
          type="button"
          className="studio-header-chip"
          aria-label="打开 Amadeus"
          onClick={() => void assistant()}
        >
          <Sparkles size={16} aria-hidden />
          <span>Amadeus</span>
        </button>
      )}
      <a
        className="studio-docs-link"
        aria-label="文档中心"
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
  );
}

export function WorkshopUtilities({
  application,
  projectId,
}: {
  application: string;
  projectId?: string;
}) {
  const open = () =>
    void openAmadeus(projectId ? { application, projectId } : { application });
  return (
    <div className="studio-workshop-utilities">
      <div className="studio-header-theme">
        <ThemeToggle compact />
      </div>
      <StudioHeaderActions assistant={open} />
    </div>
  );
}
