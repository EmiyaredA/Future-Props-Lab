import type { ReactNode } from "react";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { IndependentShell } from "./IndependentShell";

export function StudioServiceShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <RuntimeAccessProvider>
      <IndependentShell title={title}>{children}</IndependentShell>
    </RuntimeAccessProvider>
  );
}
