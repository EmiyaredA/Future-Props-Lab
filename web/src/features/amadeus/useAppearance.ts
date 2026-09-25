import { useEffect, useState } from "react";
import type { AccountSessionContext } from "@features/accounts";
import { fetchApiJson } from "@platform/api/client";
import { appearanceKey, inspectAppearance } from "@shared/live2d/appearance";
import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";
import type { CharacterDocument } from "@shared/live2d/types";

type Selection = { url: string; name: string; notice: string };
const builtIn: Selection = {
  url: AMADEUS_PACKAGE_URL,
  name: "红莉栖 · 内置角色",
  notice: "",
};

export function useAppearance(session: AccountSessionContext) {
  const [selection, setSelection] = useState<Selection>(builtIn);
  useEffect(() => {
    const key = appearanceKey(session.me.user.id, session.me.workspace.id);
    let active = true;
    const refresh = async () => {
      const id = localStorage.getItem(key);
      if (!id) {
        if (active) setSelection(builtIn);
        return;
      }
      const base = `/v1/live2d-workshop/projects/${encodeURIComponent(id)}`;
      try {
        const [project, snapshot, assets] = await Promise.all([
          fetchApiJson<{ title: string; revision: number }>(base),
          fetchApiJson<{ document: CharacterDocument }>(`${base}/document`),
          fetchApiJson<{ items: { id: string }[] }>(`${base}/assets`),
        ]);
        const issues = inspectAppearance(
          snapshot.document,
          new Set(assets.items.map((item) => item.id)),
        );
        if (issues.length) throw new Error(issues.join("；"));
        if (active)
          setSelection({
            url: `${base}/package?revision=${project.revision}`,
            name: project.title,
            notice: "",
          });
      } catch {
        localStorage.removeItem(key);
        if (active)
          setSelection({
            ...builtIn,
            notice: "所选角色无法访问或资源不完整，已恢复内置红莉栖。",
          });
      }
    };
    void refresh();
    const storage = (event: StorageEvent) => {
      if (event.key === key) void refresh();
    };
    const changed = () => void refresh();
    window.addEventListener("storage", storage);
    window.addEventListener("amadeus-appearance-changed", changed);
    return () => {
      active = false;
      window.removeEventListener("storage", storage);
      window.removeEventListener("amadeus-appearance-changed", changed);
    };
  }, [session.me.user.id, session.me.workspace.id]);
  return selection;
}
