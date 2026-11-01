import { createContext, useContext } from "react";
import type { components } from "@generated/api";
import type { AccountSessionContext } from "@features/accounts";

export type SessionUser = components["schemas"]["CurrentUserOut"];
export type AuthMe = components["schemas"]["AuthMeOut"];

export type SessionContextValue = AccountSessionContext;

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useStudioSession() {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useStudioSession must be used inside StudioAuthGate");
  return value;
}

export function useOptionalStudioSession() {
  return useContext(SessionContext);
}
