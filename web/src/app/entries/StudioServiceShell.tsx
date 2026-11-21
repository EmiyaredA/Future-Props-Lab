import type { ReactNode } from "react";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import { IndependentShell } from "./IndependentShell";

export function StudioServiceShell({
  title,
  roots,
  children,
}: {
  title: string;
  roots?: readonly string[];
  children: ReactNode;
}) {
  return (
    <RuntimeAccessProvider>
      <IndependentShell title={title} roots={roots}>
        {children}
      </IndependentShell>
    </RuntimeAccessProvider>
  );
}
