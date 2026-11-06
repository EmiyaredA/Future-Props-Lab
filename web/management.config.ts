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
        const pathname = new URL(request.url ?? "/", local).pathname;
        if (
          request.method === "GET" &&
          request.headers.accept?.includes("text/html") &&
          pathname !== "/management/v1" &&
          !pathname.startsWith("/management/v1/") &&
          (pathname === "/" ||
            pathname === "/management" ||
            pathname.startsWith("/management/"))
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
      "import.meta.env.VITE_API_BASE": JSON.stringify("/management"),
    },
    plugins: [...(shared.plugins || []), entry],
    server: {
      ...shared.server,
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/management/v1": {
          target,
          changeOrigin: true,
          headers: { Origin: target },
        },
      },
    },
  };
});
