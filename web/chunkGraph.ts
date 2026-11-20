import type { GetManualChunk } from "rollup";

/** Keep Pixi's dependency components together, packing in dependency order.
 * A directory split would create artificial cycles between renderers and scene objects.
 */
export function assistantRenderingChunks(): GetManualChunk {
  return dependencyChunks(
    (key) =>
      key.includes("/node_modules/pixi.js/") ||
      key.includes("/node_modules/earcut/"),
    "assistant-rendering",
  );
}

export function trumanMapChunks(): GetManualChunk {
  const editorScripts = dependencyChunks(
    (key) =>
      key.includes("/vendor/toonflow/truman-map/") &&
      !key.includes("?vue&type=style") &&
      !key.endsWith("/sceneDocument.ts"),
    "truman-map",
  );
  return (id, context) => {
    if (id.includes("/element-plus/theme-chalk/"))
      return "truman-controls-style";
    if (
      id.includes("/vendor/toonflow/truman-map/") &&
      id.includes("?vue&type=style")
    ) {
      return id.includes("/sceneStudio.vue?")
        ? "truman-stage-style"
        : "truman-tools-style";
    }
    return editorScripts(id, context);
  };
}

function dependencyChunks(
  owns: (key: string) => boolean,
  name: string,
): GetManualChunk {
  let chunks: Map<string, string> | undefined;
  return (id, context) => {
    if (!owns(id)) return;
    if (!chunks) {
      const all = new Set([...context.getModuleIds()].filter(owns));
      const index = new Map<string, number>();
      const low = new Map<string, number>();
      const stack: string[] = [];
      const active = new Set<string>();
      const components: string[][] = [];
      let next = 0;
      const visit = (key: string) => {
        index.set(key, next);
        low.set(key, next++);
        stack.push(key);
        active.add(key);
        for (const dependency of context.getModuleInfo(key)?.importedIds ||
          []) {
          if (!all.has(dependency)) continue;
          if (!index.has(dependency)) {
            visit(dependency);
            low.set(key, Math.min(low.get(key)!, low.get(dependency)!));
          } else if (active.has(dependency))
            low.set(key, Math.min(low.get(key)!, index.get(dependency)!));
        }
        if (low.get(key) !== index.get(key)) return;
        const members: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          active.delete(member);
          members.push(member);
        } while (member !== key);
        components.push(members);
      };
      [...all].sort().forEach((key) => {
        if (!index.has(key)) visit(key);
      });
      chunks = new Map();
      let group = 0,
        bytes = 0;
      for (const members of components) {
        const size = members.reduce(
          (sum, key) => sum + (context.getModuleInfo(key)?.code?.length || 0),
          0,
        );
        if (bytes && bytes + size > 350_000) {
          group++;
          bytes = 0;
        }
        members.forEach((key) => chunks!.set(key, `${name}-${group}`));
        bytes += size;
      }
    }
    return chunks.get(id);
  };
}

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
