import { useCallback, type ReactNode } from "react";
import { useApplicationNavigation } from "./useApplicationNavigation";
import { ApplicationNavigationContext } from "./applicationNavigationContext";

const noRoots: readonly string[] = [];

export function ApplicationNavigation({
  scope,
  roots = noRoots,
  children,
}: {
  scope: string;
  roots?: readonly string[];
  children: ReactNode;
}) {
  const ownsPath = useCallback(
    (path: string) =>
      roots.some(
        (root) =>
          path === root || (root !== "/" && path.startsWith(root + "/")),
      ),
    [roots],
  );
  const navigation = useApplicationNavigation(scope, ownsPath);
  return (
    <ApplicationNavigationContext value={navigation}>
      {children}
    </ApplicationNavigationContext>
  );
}
