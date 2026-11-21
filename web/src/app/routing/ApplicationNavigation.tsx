import { useCallback, type ReactNode } from "react";
import { useApplicationNavigation } from "./useApplicationNavigation";
import { ApplicationNavigationContext } from "./applicationNavigationContext";

const noRoots: readonly string[] = [];

export function ApplicationNavigation({
  scope,
  roots = noRoots,
  exactPaths = noRoots,
  children,
}: {
  scope: string;
  /** Own each root and its descendants. */
  roots?: readonly string[];
  /** Own leaf pages without taking over another application's descendants. */
  exactPaths?: readonly string[];
  children: ReactNode;
}) {
  const ownsPath = useCallback(
    (path: string) =>
      exactPaths.some(
        (entry) => path === entry || (entry !== "/" && path === entry + "/"),
      ) ||
      roots.some(
        (root) =>
          path === root || (root !== "/" && path.startsWith(root + "/")),
      ),
    [roots, exactPaths],
  );
  const navigation = useApplicationNavigation(scope, ownsPath);
  return (
    <ApplicationNavigationContext value={navigation}>
      {children}
    </ApplicationNavigationContext>
  );
}
