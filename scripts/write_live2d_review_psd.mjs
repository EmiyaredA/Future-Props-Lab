import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeCanvas, readPsd, writePsd } from "ag-psd";

const root = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(root, "layer-manifest.json"), "utf8"));
initializeCanvas(
  (width, height) => ({ width, height }),
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);
const children = [...manifest.layers].reverse().map((layer) => ({
  name: layer.name,
  left: layer.x,
  top: layer.y,
  hidden: !layer.visible,
  imageData: {
    data: new Uint8ClampedArray(readFileSync(resolve(root, ".psd-work", `${layer.id}.rgba`))),
    width: layer.width,
    height: layer.height,
  },
}));
const file = resolve(root, "kurisu-rig-draft.psd");
const bytes = writePsd({
  width: manifest.width,
  height: manifest.height,
  colorMode: 3,
  bitsPerChannel: 8,
  children,
});
writeFileSync(file, Buffer.from(bytes));
const reopened = readPsd(bytes, { useImageData: true });
if (reopened.children?.length !== children.length) throw new Error("PSD layer round trip failed");
for (const [index, layer] of reopened.children.entries()) {
  if (layer.name !== children[index].name || !layer.imageData?.data?.length)
    throw new Error(`PSD layer ${index} did not round trip`);
}
process.stdout.write(`${children.length} PSD layers verified\n`);
