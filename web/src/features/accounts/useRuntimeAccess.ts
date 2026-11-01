import { createContext, useContext } from "react";
export const RuntimeAccessContext = createContext(false);

export function useRuntimeAccess() {
  return useContext(RuntimeAccessContext);
}
