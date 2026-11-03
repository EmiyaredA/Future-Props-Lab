import fs from "node:fs";
import { imageVariants as variants } from "../src/shared/lib/imageVariants.ts";
import { fileURLToPath } from "node:url";

export const serviceAssets = {
  integrations: ["brand/brand-mark.png", "brand/favicon.png"],
  assets: ["brand/brand-mark.png", "brand/favicon.png"],
  models: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "providers/qwen-logo.svg",
    "providers/deepseek-logo.svg",
    "providers/senseaudio-logo.svg",
    ...fs
      .readdirSync(
        fileURLToPath(new URL("../public/voice-vad/", import.meta.url)),
      )
      .filter((name) => /\.(?:onnx|wasm|js)$/.test(name))
      .map((name) => "voice-vad/" + name),
  ],
  management: ["brand/brand-mark.png", "brand/favicon.png"],
  portal: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/home/kurisu-idle.png",
    "brand/home/kurisu-idle.webm",
    "brand/agent-workbench-mark.png",
    "brand/presentation-workshop-mark.png",
    "brand/thought-workshop-mark.png",
    "brand/interview-assistant-mark.png",
    "brand/visual-workshop-mark.png",
    "brand/galgame-workshop-mark.png",
    "brand/video-editor-mark.png",
    "brand/motion-compositor-mark.png",
    "brand/audio-annotation-mark.png",
    "brand/director-desk-mark.png",
    ...fs
      .readdirSync(fileURLToPath(new URL("../public/docs/", import.meta.url)))
      .filter((name) => /\.(?:jpg|png|svg|webp)$/.test(name))
      .sort()
      .map((name) => "docs/" + name),
  ],
  agents: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "providers/codex-logo.svg",
    "providers/claudecode-logo.svg",
    "providers/opencode-logo.svg",
    "providers/deepseek-logo.svg",
    "providers/pi-logo.svg",
  ],
};

// Repo-owned generated paths are fixed inputs to each independent program build.
serviceAssets.portal.push(
  ...serviceAssets.agents.filter((name) => name.startsWith("providers/")),
);
for (const [service, originals] of Object.entries(serviceAssets)) {
  const related = originals.flatMap((name) =>
    Object.values(variants["/" + name] || {}).map((value) =>
      value.replace(/^\//, ""),
    ),
  );
  serviceAssets[service] = [...new Set([...originals, ...related])].sort();
}
