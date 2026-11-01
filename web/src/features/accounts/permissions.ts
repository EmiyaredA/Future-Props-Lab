import type { AuthMe } from "./api";
export function accountAllows(account: AuthMe, permission: string) {
  return account.permission_keys?.includes(permission) ?? false;
}
