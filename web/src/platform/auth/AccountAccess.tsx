import { createContext, useContext, type ReactNode } from "react";
const AccountAccess = createContext<{
  userId: string;
  permissions: readonly string[];
} | null>(null);
export function AccountAccessProvider({
  userId,
  permissions,
  children,
}: {
  userId: string;
  permissions: readonly string[];
  children: ReactNode;
}) {
  return (
    <AccountAccess.Provider value={{ userId, permissions }}>
      {children}
    </AccountAccess.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAccountId() {
  return useContext(AccountAccess)?.userId ?? null;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAccountPermission(permission: string) {
  return useContext(AccountAccess)?.permissions.includes(permission) ?? false;
}
