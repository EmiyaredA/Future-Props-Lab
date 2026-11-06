import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { managedBundle } from "@features/presentation-workshop/master/bundledAssets";
import { uploadImage } from "@features/presentation-workshop/api";
import {
  studioDefinition,
  starterDocument,
} from "@features/presentation-workshop/master/studioPreview";
import { resolveSlide } from "@features/presentation-workshop/master/model";
vi.mock("@features/presentation-workshop/api", () => ({
  uploadImage: vi.fn(),
}));

describe("模板内置素材交付", () => {
  beforeEach(() => {
    vi.mocked(uploadImage).mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["png"], { type: "image/png" }),
      })),
    );
    vi.mocked(uploadImage).mockImplementation(
      async (file) =>
        ({ id: `managed-${file.name}` }) as Awaited<
          ReturnType<typeof uploadImage>
        >,
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it("入门包中的背景和插画各上传一次，所有快照使用托管 ID，输入保持原样", async () => {
    const definition = studioDefinition();
    const input = { definition, document: starterDocument(definition) };
    const original = JSON.stringify(input);
    const saved = await managedBundle(input);
    expect(uploadImage).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(input)).toBe(original);
    expect(saved.definition.version).toBe(2);
    expect(saved.document.template?.snapshot.version).toBe(2);
    expect(
      saved.document.slides[3].elements
        .filter((e) => e.kind === "image")
        .map((e) => e.asset_id),
    ).toEqual([
      "managed-studio-structured.png",
      "managed-studio-html.png",
      "managed-studio-visual.png",
    ]);
  });
  it("已有托管素材无需重新上传，普通文字中的相似 ID 不转换", async () => {
    const value = { asset_id: "workspace-image", title: "studio-html" };
    expect(await managedBundle(value)).toEqual(value);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("素材加载失败时中止保存，不生成不可用的素材引用", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await expect(managedBundle(studioDefinition())).rejects.toThrow(
      "模板内置素材加载失败",
    );
    expect(uploadImage).not.toHaveBeenCalled();
  });
  it("素材上传失败时向调用方报告，不返回半完成的模板", async () => {
    vi.mocked(uploadImage).mockRejectedValueOnce(new Error("上传失败"));
    await expect(managedBundle(studioDefinition())).rejects.toThrow("上传失败");
  });
  it("五页示例的正文不携带解析出的模板对象，目录和页码按实际顺序生成", () => {
    const deck = starterDocument(studioDefinition());
    expect(deck.slides.map((s) => s.page_type)).toEqual([
      "cover",
      "toc",
      "section",
      "content",
      "ending",
    ]);
    expect(
      deck.slides.every((s) =>
        s.elements.every((e) => !e.id.startsWith("master-")),
      ),
    ).toBe(true);
    const toc = resolveSlide(deck, deck.slides[1])
      .elements.flatMap((e) =>
        e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)),
      )
      .join("\n");
    expect(toc).toContain("技术方案    3");
    expect(toc).toContain("PPT Agent    4");
  });
});
