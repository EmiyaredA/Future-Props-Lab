import { useEffect } from "react";
import type { AccountSessionContext } from "@features/accounts";
import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";

const builtIn = {
  url: AMADEUS_PACKAGE_URL,
  name: "红莉栖 · 内置角色",
  notice: "",
};

export function useAppearance(session: AccountSessionContext) {
  const userId = session.me.user.id;
  useEffect(() => {
    localStorage.removeItem(`amadeus-appearance:${userId}:${userId}`);
  }, [userId]);
  return builtIn;
}
