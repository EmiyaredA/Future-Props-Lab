import type { ReactNode } from "react";
import { ApplicationNavigation } from "@app/routing/ApplicationNavigation";

/** Keep routing real when a focused entry test replaces the visual shell. */
export function IndependentTestShell({
  children,
  roots,
}: {
  children: ReactNode;
  roots?: readonly string[];
}) {
  return (
    <ApplicationNavigation scope="test-entry" roots={roots}>
      <main>{children}</main>
    </ApplicationNavigation>
  );
}
