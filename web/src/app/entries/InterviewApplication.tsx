import { lazy, useCallback, useEffect, useRef } from "react";
import { useStudioSession } from "@app/StudioSession";
import { INTERVIEW_ASSISTANT_MODULE } from "@features/interview-assistant/module";
import type { RegisterNavigationGuard } from "@features/interview-assistant/types";
import { useNavigationProtection } from "@shared/ui/navigationGuards";
import { IndependentShell } from "./IndependentShell";

const InterviewPage = lazy(INTERVIEW_ASSISTANT_MODULE.pages.workspace);

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
      key={scopeKey}
      scopeKey={scopeKey}
      registerNavigationGuard={registerNavigationGuard}
    />
  );
}

export default function InterviewApplication() {
  return (
    <IndependentShell title="面试助手">
      <InterviewContent />
    </IndependentShell>
  );
}
