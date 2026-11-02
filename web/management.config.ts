import { defineConfig, type Plugin } from "vite";
import baseConfig from "./vite.config";

export default defineConfig(async (environment) => {
  const shared = await baseConfig(environment);
  const port = Number(process.env.FPL_MANAGEMENT_WEB_PORT || "3001");
  const target =
    process.env.FPL_MANAGEMENT_API_TARGET || "http://127.0.0.1:9002";
  const local = `http://127.0.0.1:${port}`;
  const entry: Plugin = {
    name: "management-entry",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          request.headers.host !== `127.0.0.1:${port}` ||
          (request.headers.origin && request.headers.origin !== local)
        ) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }
        if (
          request.method === "GET" &&
          request.headers.accept?.includes("text/html") &&
          (request.url === "/" || request.url?.startsWith("/management/"))
        )
          request.url = "/management.html";
        next();
      });
    },
  };
  return {
    ...shared,
    cacheDir: "node_modules/.vite-management",
    define: {
      ...shared.define,
      "import.meta.env.VITE_FPL_SERVICE": JSON.stringify("management"),
    },
    plugins: [...(shared.plugins || []), entry],
    server: {
      ...shared.server,
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/v1": { target, changeOrigin: true, headers: { Origin: target } },
      },
    },
  };
});
