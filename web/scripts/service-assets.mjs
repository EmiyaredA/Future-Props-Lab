import fs from "node:fs";
import { imageVariants as variants } from "../src/shared/lib/imageVariants.ts";
import { fileURLToPath } from "node:url";

const workshopMarks = [
  "brand/presentation-workshop-mark.png",
  "brand/thought-workshop-mark.png",
  "brand/interview-assistant-mark.png",
  "brand/visual-workshop-mark.png",
  "brand/galgame-workshop-mark.png",
  "brand/video-editor-mark.png",
  "brand/motion-compositor-mark.png",
  "brand/audio-annotation-mark.png",
  "brand/director-desk-mark.png",
];

export const serviceAssets = {
  thought: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/thought-workshop-mark.png",
  ],
  creative: ["brand/brand-mark.png", "brand/favicon.png"],
  "agent-runtime": [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "providers/codex-logo.svg",
    "providers/claudecode-logo.svg",
    "providers/opencode-logo.svg",
    "providers/deepseek-logo.svg",
    "providers/pi-logo.svg",
  ],
  annotation: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/audio-annotation-mark.png",
  ],
  video: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/video-editor-mark.png",
  ],
  visual: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/visual-workshop-mark.png",
    "brand/visual-workshop-mark-cutout.png",
    "providers/codex-logo.svg",
    "providers/claudecode-logo.svg",
    "providers/opencode-logo.svg",
    "providers/deepseek-logo.svg",
    "providers/pi-logo.svg",
    "providers/qwen-logo.svg",
    "providers/senseaudio-logo.svg",
  ],
  galgame: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/galgame-workshop-mark.png",
    "brand/galgame-workshop-mark-cutout.png",
  ],
  motion: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/motion-compositor-mark.png",
  ],
  presentation: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/presentation-workshop-mark.png",
    "presentation-templates/report-background.png",
    "presentation-templates/structured-template.png",
    "presentation-templates/html-template.png",
    "presentation-templates/visual-generation.png",
  ],
  interview: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/interview-assistant-mark.png",
  ],
  director: [
    "brand/brand-mark.png",
    "brand/favicon.png",
    "brand/director-desk-mark.png",
  ],
  tools: ["brand/brand-mark.png", "brand/favicon.png"],
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
    "providers/codex-logo.svg",
    "providers/claudecode-logo.svg",
    "providers/opencode-logo.svg",
    "providers/deepseek-logo.svg",
    "providers/pi-logo.svg",
    ...workshopMarks,
    ...fs
      .readdirSync(fileURLToPath(new URL("../public/docs/", import.meta.url)))
      .filter((name) => /\.(?:jpg|png|svg|webp)$/.test(name))
      .sort()
      .map((name) => "docs/" + name),
  ],
};

// Repo-owned generated paths are fixed inputs to each independent program build.
const loadingAssets = [
  "divergence-meter.webp",
  "dr-pepper.webp",
  "flip-phone.webp",
  "gel-banana.webp",
  "kurisu-run.png",
  "kurisu-run.webm",
  "kurisu-run.webp",
  "loading-dial.svg",
  "metal-upa.webp",
  "phonewave.webp",
  "pocket-watch.webp",
  "time-machine.webp",
].map((name) => "brand/loading/" + name);

const amadeusAssets = [
  "brand/amadeus/HAPPIER-LICENSE.txt",
  "brand/amadeus/REMEND-LICENSE.txt",
  "brand/amadeus/amadeus-poster.png",
  "brand/amadeus/amadeus-stage-poster.png",
  "brand/amadeus/amadeus.fpllive2d",
  ...workshopMarks.map((name) => variants["/" + name]["64"].slice(1)),
];

for (const [service, originals] of Object.entries(serviceAssets)) {
  const related = originals.flatMap((name) =>
    Object.values(variants["/" + name] || {}).map((value) =>
      value.replace(/^\//, ""),
    ),
  );
  serviceAssets[service] = [
    ...new Set([
      ...originals,
      ...related,
      ...loadingAssets,
      ...(service === "management" ? [] : amadeusAssets),
    ]),
  ].sort();
}
