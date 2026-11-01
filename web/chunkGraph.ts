import type { GetManualChunk } from "rollup";

/** Keep paths between resource modules together, without pulling leaf vendors in. */
export function directorResourceChunks(): GetManualChunk {
  let members: Set<string> | undefined;
  return (id, context) => {
    if (!id.includes("/features/director-desk/")) return;
    if (!members) {
      const ids = [...context.getModuleIds()].filter((key) =>
        key.includes("/features/director-desk/"),
      );
      const all = new Set(ids);
      const forward = new Map(
        ids.map((key) => [
          key,
          (context.getModuleInfo(key)?.importedIds || []).filter((dep) =>
            all.has(dep),
          ),
        ]),
      );
      const backward = new Map(ids.map((key) => [key, [] as string[]]));
      for (const [key, deps] of forward)
        for (const dep of deps) backward.get(dep)!.push(key);
      const seeds = ids.filter((key) =>
        /\/editor\/(resources|animation)\//.test(key),
      );
      function reachable(edges: Map<string, string[]>) {
        const found = new Set<string>();
        const pending = [...seeds];
        while (pending.length) {
          const key = pending.pop()!;
          if (found.has(key)) continue;
          found.add(key);
          pending.push(...(edges.get(key) || []));
        }
        return found;
      }
      const ancestors = reachable(backward);
      members = new Set(
        [...reachable(forward)].filter((key) => ancestors.has(key)),
      );
    }
    if (members.has(id)) return "director-resources";
    if (id.includes("/editor/automation/")) return "director-automation";
  };
}
