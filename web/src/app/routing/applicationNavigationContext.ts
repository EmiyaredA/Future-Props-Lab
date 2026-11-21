import { createContext, useContext } from "react";
import type { useApplicationNavigation } from "./useApplicationNavigation";

export const ApplicationNavigationContext = createContext<ReturnType<
  typeof useApplicationNavigation
> | null>(null);

export function useApplicationLocation() {
  const navigation = useContext(ApplicationNavigationContext);
  if (!navigation)
    throw new Error("Application navigation requires its owning shell");
  return navigation;
}
