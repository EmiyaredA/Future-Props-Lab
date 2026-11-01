import { expect, test } from "vitest";
import type { GetManualChunk } from "rollup";
import { directorResourceChunks } from "../chunkGraph";

test("resource chunks include intervening modules and leave leaf vendors and callers separate", () => {
  const root = "/web/src/features/director-desk/editor/";
  const a = root + "resources/a.ts",
    b = root + "animation/b.ts";
  const middle = root + "scenes/pose.ts",
    caller = root + "automation/service.ts";
  const vendor = "/node_modules/three/index.js";
  const graph = new Map([
    [a, [middle, vendor]],
    [middle, [b]],
    [b, []],
    [caller, [a]],
    [vendor, []],
  ]);
  const context = {
    getModuleIds: () => graph.keys(),
    getModuleInfo: (id: string) => ({ importedIds: graph.get(id) }),
  } as unknown as Parameters<GetManualChunk>[1];
  const classify = directorResourceChunks();
  expect(classify(a, context)).toBe("director-resources");
  expect(classify(middle, context)).toBe("director-resources");
  expect(classify(b, context)).toBe("director-resources");
  expect(classify(caller, context)).toBe("director-automation");
  expect(classify(vendor, context)).toBeUndefined();
});
