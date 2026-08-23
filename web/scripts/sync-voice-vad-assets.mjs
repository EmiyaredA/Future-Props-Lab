import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dependenciesRoot = resolve(webRoot, "../node_modules");
const outputRoot = resolve(webRoot, "public/voice-vad");
const checkOnly = process.argv.includes("--check");
const assets = [
  resolve(dependenciesRoot, "@ricky0123/vad-web/dist/silero_vad_v5.onnx"),
  resolve(
    dependenciesRoot,
    "@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
  ),
  resolve(dependenciesRoot, "onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
];

await mkdir(outputRoot, { recursive: true });

for (const source of assets) {
  const target = resolve(outputRoot, basename(source));
  if (checkOnly) {
    try {
      const [sourceBytes, targetBytes] = await Promise.all([
        readFile(source),
        readFile(target),
      ]);
      if (!sourceBytes.equals(targetBytes)) throw new Error("stale");
    } catch {
      console.error(
        `Voice VAD asset is missing or stale: ${basename(source)}. Run npm run voice-vad:sync --workspace web.`,
      );
      process.exitCode = 1;
    }
  } else {
    await copyFile(source, target);
  }
}

if (!checkOnly) console.log(`Updated voice VAD assets in ${outputRoot}`);
