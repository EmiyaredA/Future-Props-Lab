import { WorkshopUtilities } from "@app/layout/StudioGlobalHeader";
import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { AmadeusPageProvider } from "@features/amadeus/PageProvider";
import { INTERVIEW_ASSISTANT_MODULE as interview } from "@features/interview-assistant/module";
import type { RegisterNavigationGuard } from "@features/interview-assistant/types";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationProtection } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const InterviewPage = lazy(interview.pages.workspace);

function InterviewContent() {
  const { me } = useStudioSession();
  const protection = useNavigationProtection();
  const unregister = useRef<(() => void) | null>(null);
  const registerNavigationGuard = useCallback<RegisterNavigationGuard>(
    (guard) => {
      unregister.current?.();
      unregister.current =
        guard && protection ? protection.register(guard) : null;
    },
    [protection],
  );
  useEffect(() => () => unregister.current?.(), []);
  const scopeKey = `${me.user.id}:${me.user.id}`;
  return (
    <InterviewPage
      utilities={<WorkshopUtilities application={interview.definition.name} />}
      key={scopeKey}
      scopeKey={scopeKey}
      registerNavigationGuard={registerNavigationGuard}
    />
  );
}

export default function InterviewApplication() {
  const session = useStudioSession();
  return (
    <AmadeusPageProvider key={session.me.user.id} session={session}>
      <NavigationProtection>
        <WorkshopShell
          module={interview}
          page="interview-assistant-session"
          navigate={() => {}}
          onBack={() => guardedNavigation(() => location.assign("/apps"), true)}
        >
          <ApplicationUpdate />
          <InterviewContent />
        </WorkshopShell>
      </NavigationProtection>
    </AmadeusPageProvider>
  );
}
