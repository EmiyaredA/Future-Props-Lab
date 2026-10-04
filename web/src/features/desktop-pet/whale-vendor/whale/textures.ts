type WhaleScheme = {
  id: string;
  ready?: boolean;
  accent?: string;
  brand?: string;
};
type WhaleTextures = {
  tex: Record<string, HTMLImageElement>;
  img: Record<string, HTMLImageElement>;
};
function loadImage(url: string | URL) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("鲸鱼桌宠贴图无法加载"));
    image.src = String(url);
  });
}

/** One promise per scheme, one image per texture ID; failed loads may be explicitly retried. */
export function whaleTextureLibrary(
  model: { parts: { tex: string }[]; schemes?: WhaleScheme[] },
  features: string[],
  asset: (path: string) => string | URL,
) {
  const schemes = (model.schemes ?? [{ id: "deepseek" }]).filter(
    (scheme) => scheme.ready !== false,
  );
  if (!schemes.length) throw new Error("鲸鱼桌宠没有可用配色");
  const schemeInfo = (id: string) =>
    schemes.find((scheme) => scheme.id === id) ?? schemes[0];
  const loaded = new Map<string, Promise<WhaleTextures>>();
  const ready: Record<string, WhaleTextures> = {};
  function loadScheme(id: string) {
    const selected = schemeInfo(id).id;
    const cached = loaded.get(selected);
    if (cached) return cached;
    const directory = selected === schemes[0].id ? "" : `schemes/${selected}/`;
    const set: WhaleTextures = { tex: {}, img: {} };
    const pending = Promise.all([
      ...[...new Set(model.parts.map((part) => part.tex))].map(async (name) => {
        set.tex[name] = await loadImage(asset(`${directory}tex/${name}.png`));
      }),
      ...[...new Set(features)].map(async (name) => {
        set.img[name] = await loadImage(asset(`${directory}feat/${name}.png`));
      }),
    ])
      .then(() => {
        ready[selected] = set;
        return set;
      })
      .catch((error: unknown) => {
        loaded.delete(selected);
        throw error;
      });
    loaded.set(selected, pending);
    return pending;
  }
  return { schemes, schemeInfo, ready, loadScheme };
}
