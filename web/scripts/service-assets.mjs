import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const serviceAssets = {
  assets: ["brand/brand-mark.png", "brand/favicon.png"],
  portal: [
    "brand/brand-mark.png", "brand/favicon.png",
    "brand/home/kurisu-idle.png", "brand/home/kurisu-idle.webm",
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
    ...fs.readdirSync(fileURLToPath(new URL("../public/docs/", import.meta.url)))
      .filter((name) => /\.(?:jpg|png|svg|webp)$/.test(name))
      .sort().map((name) => "docs/" + name),
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
