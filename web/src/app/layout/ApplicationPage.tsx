import { Suspense, type ReactNode } from "react";
import { LoadingState } from "@shared/ui/LoadingState";

/** Lazy pages load inside their application's persistent chrome. */
export function ApplicationPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={<LoadingState label="正在打开页面…" variant="region" />}
    >
      {children}
    </Suspense>
  );
}
