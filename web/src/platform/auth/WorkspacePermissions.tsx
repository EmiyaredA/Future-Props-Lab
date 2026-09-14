import { createContext, useContext, type ReactNode } from "react";
const WorkspacePermissions = createContext<readonly string[] | null>(null);
const WorkspaceIdentity = createContext<string | null>(null);
export function WorkspacePermissionsProvider({
  permissions,
  workspaceId = null,
  children,
}: {
  permissions: readonly string[];
  workspaceId?: string | null;
  children: ReactNode;
}) {
  return (
    <WorkspacePermissions.Provider value={permissions}>
      <WorkspaceIdentity.Provider value={workspaceId}>
        {children}
      </WorkspaceIdentity.Provider>
    </WorkspacePermissions.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceId() {
  return useContext(WorkspaceIdentity);
}
// This small context module intentionally exports its provider and consumer hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspacePermission(permission: string) {
  const permissions = useContext(WorkspacePermissions);
  return permissions === null || permissions.includes(permission);
}
