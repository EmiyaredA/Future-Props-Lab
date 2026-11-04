import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import baseConfig from "./vite.config";

import { serviceAssets } from "./scripts/service-assets.mjs";

function programResources(publicFiles: string[]): Plugin {
  return {
    name: "owned-program-resources",
    generateBundle() {
      for (const name of publicFiles) {
        const source = readFileSync(resolve(__dirname, "public", name));
        if (
          source
            .subarray(0, 80)
            .toString()
            .startsWith("version https://git-lfs")
        )
          throw new Error("Missing LFS program resource: " + name);
        this.emitFile({ type: "asset", fileName: name, source });
      }
    },
  };
}

export default defineConfig(async (environment) => {
  const service = process.env.FPL_WEB_SERVICE;
  const build = process.env.FPL_WEB_BUILD_ID;
  if (
    !service ||
    ![
      "agents",
      "portal",
      "assets",
      "management",
      "models",
      "integrations",
      "creative",
      "thought",
    ].includes(service) ||
    !build ||
    !/^[a-f0-9]{20}$/.test(build)
  )
    throw new Error("Select a supported service and an immutable web build ID");
  const shared = await baseConfig({ ...environment, mode: "studio" });
  const sourceHash = createHash("sha256")
    .update(service)
    .update(build)
    .digest("hex");
  return {
    ...shared,
    envDir: false,
    publicDir: false,
    base: "/_apps/" + service + "/" + build + "/",
    plugins: [
      ...(shared.plugins || []),
      programResources(
        serviceAssets[
          service as
            | "agents"
            | "portal"
            | "assets"
            | "management"
            | "models"
            | "integrations"
            | "creative"
            | "thought"
        ],
      ),
    ],
    define: {
      ...shared.define,
      "import.meta.env.VITE_FPL_SERVICE": JSON.stringify(service),
      "import.meta.env.VITE_FPL_WEB_BUILD": JSON.stringify(build),
      "import.meta.env.VITE_FPL_PROGRAM_HASH": JSON.stringify(sourceHash),
    },
    build: {
      ...shared.build,
      sourcemap: false,
      outDir: process.env.FPL_WEB_DIST_DIR,
      rollupOptions: {
        ...shared.build?.rollupOptions,
        input: resolve(__dirname, service + ".html"),
      },
    },
  };
});
