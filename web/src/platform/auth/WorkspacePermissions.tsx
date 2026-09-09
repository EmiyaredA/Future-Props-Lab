import { createContext, useContext, type ReactNode } from "react";
const WorkspacePermissions = createContext<readonly string[] | null>(null);
export function WorkspacePermissionsProvider({
  permissions,
  children,
}: {
  permissions: readonly string[];
  children: ReactNode;
}) {
  return (
    <WorkspacePermissions.Provider value={permissions}>
      {children}
    </WorkspacePermissions.Provider>
  );
}
// This small context module intentionally exports its provider and consumer hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspacePermission(permission: string) {
  const permissions = useContext(WorkspacePermissions);
  return permissions === null || permissions.includes(permission);
}
