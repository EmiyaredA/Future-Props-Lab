import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import baseConfig from "./vite.config";

type NativePage = {
  service: string;
  roots: string[];
  build: string;
  entry: string;
};

function independentPages(pages: NativePage[]): Plugin {
  return {
    name: "native-independent-pages",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url || "/", "http://127.0.0.1:3000");
        if (request.headers.accept?.includes("text/html")) {
          const page = pages
            .filter((page) =>
              page.roots.some(
                (root) =>
                  url.pathname === root ||
                  (root !== "/" &&
                    !root.endsWith(".html") &&
                    url.pathname.startsWith(root + "/")),
              ),
            )
            .sort(
              (left, right) =>
                Math.max(...right.roots.map((root) => root.length)) -
                Math.max(...left.roots.map((root) => root.length)),
            )[0];
          if (page) request.url = "/" + page.entry + url.search;
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(_html, context) {
        const page = pages.find(
          (page) => page.entry === basename(context.filename),
        );
        if (!page) return [];
        return [
          {
            tag: "script",
            injectTo: "head-prepend",
            children:
              "globalThis.__FPL_NATIVE__=" +
              JSON.stringify({
                service: page.service,
                build: page.build,
                apiBase: page.service === "management" ? "/management" : "",
              }).replace(/</g, "\\u003c") +
              ";",
          },
        ];
      },
    },
  };
}

export default defineConfig(async (environment) => {
  const filename = process.env.FPL_NATIVE_WEB_CONFIG;
  if (!filename) throw new Error("Start native development with npm run dev");
  const pages = JSON.parse(readFileSync(filename, "utf8")) as NativePage[];
  const shared = await baseConfig({ ...environment, mode: "studio" });
  return {
    ...shared,
    envDir: false as const,
    plugins: [...(shared.plugins || []), independentPages(pages)],
    define: {
      "import.meta.env.VITE_API_BASE": "globalThis.__FPL_NATIVE__.apiBase",
      "import.meta.env.VITE_FPL_SERVICE": "globalThis.__FPL_NATIVE__.service",
      "import.meta.env.VITE_FPL_WEB_BUILD": "globalThis.__FPL_NATIVE__.build",
    },
    server: {
      ...shared.server,
      host: "127.0.0.1",
      port: 3000,
      strictPort: true,
      fs: {
        allow: [
          resolve(__dirname),
          resolve(__dirname, "../node_modules"),
          resolve(__dirname, "../vendor/fortune-sheet"),
          ...(process.env.FPL_VITE_CACHE_DIR
            ? [process.env.FPL_VITE_CACHE_DIR]
            : []),
        ],
        deny: ["**/.git/**", "**/.env*", "**/*.{pem,key,db,sqlite,sqlite3}"],
      },
      proxy: {
        "/management/_internal": { target: "http://127.0.0.1:9002" },
        "/management/_native": { target: "http://127.0.0.1:9002" },
        "/management/_bridge": { target: "http://127.0.0.1:9002" },
        "/management/v1": {
          target: "http://127.0.0.1:9002",
          ws: true,
          changeOrigin: false,
        },
        ...Object.fromEntries(
          [
            "/v1",
            "/health",
            "/ready",
            "/build.json",
            "/_apps",
            "/_internal",
            "/_native",
            "/_bridge",
          ].map((prefix) => [
            prefix,
            {
              target: "http://127.0.0.1:9001",
              ws: true,
              changeOrigin: false,
            },
          ]),
        ),
      },
    },
  };
});
