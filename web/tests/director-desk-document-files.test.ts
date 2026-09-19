import { describe, expect, it } from "vitest";
import { externalizeTree, hydrateTree } from "@features/director-desk/documentFiles";

describe("director desk document files", () => {
  it("replaces embedded bytes with keys and restores them", async () => {
    const stored = new Map<string, Uint8Array>();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const model = Uint8Array.from([1, 2, 3, 4, 5]);
    const upload = async (bytes: Uint8Array) => {
      const key = bytes.length === png.length ? "a".repeat(64) : "b".repeat(64);
      stored.set(key, bytes);
      return key;
    };
    const source = {
      resources: [{ package: { files: [{ path: "hero.glb", data: btoa("\u0001\u0002\u0003\u0004\u0005") }] } }],
      scenes: [{ references: [{ id: "ref", name: "参考", data: `data:image/png;base64,${btoa(String.fromCharCode(...png))}` }] }],
    };
    const slim = (await externalizeTree(source, upload)) as {
      resources: { package: { files: { path: string; file: string; data?: string }[] } }[];
      scenes: { references: { file: string; data?: string }[] }[];
    };
    expect(slim.resources[0].package.files[0]).toEqual({ path: "hero.glb", file: "b".repeat(64) });
    expect(slim.scenes[0].references[0].data).toBeUndefined();
    expect(source.resources[0].package.files[0].data).toContain("AQIDBAU");
    const restored = (await hydrateTree(slim, async (key) => stored.get(key) ?? model)) as {
      resources: { package: { files: { data: string; file?: string }[] } }[];
      scenes: { references: { data: string }[] }[];
    };
    expect(restored.resources[0].package.files[0].data).toBe(btoa("\u0001\u0002\u0003\u0004\u0005"));
    expect(restored.resources[0].package.files[0].file).toBeUndefined();
    expect(restored.scenes[0].references[0].data.startsWith("data:image/png;base64,")).toBe(true);
  });
});
