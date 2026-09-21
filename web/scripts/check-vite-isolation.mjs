// Deterministic dependency-cache regression; no backend or user data.
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "fpl-vite-isolation-"));
const servers = [];
const browser = await chromium.launch({ headless: true });
const shared = process.argv.includes("--shared");
async function start(name, extra) {
  const server = await createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    mode: name,
    cacheDir: join(temporary, shared ? "shared" : name, "node_modules/.vite"),
    optimizeDeps: {
      noDiscovery: true,
      entries: [],
      include: ["react", "react-dom/client", ...extra],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      open: false,
      fs: { allow: [root, resolve(root, ".."), temporary] },
    },
    plugins: [
      {
        name: "isolation-probe",
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url === "/probe") {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<div id="root"></div><script type="module" src="/probe.js"></script>',
              );
            } else if (req.url === "/probe.js") {
              void vite
                .transformRequest("/probe-entry.js")
                .then((result) => {
                  res.setHeader("Content-Type", "text/javascript");
                  res.end(result.code);
                })
                .catch(next);
            } else next();
          });
        },
        resolveId(id) {
          if (id === "/probe-entry.js") return id;
        },
        load(id) {
          if (id === "/probe-entry.js")
            return `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement('button', {onClick: async () => {
          const Dialog = await import('@radix-ui/react-dialog');
          root.render(React.createElement(Dialog.Root, {open:true},
            React.createElement(Dialog.Content, null,
              React.createElement(Dialog.Title, null, 'Dialog ready'),
              React.createElement(Dialog.Description, null, 'cache probe'))));
        }}, 'Open dialog'));`;
        },
      },
    ],
  });
  servers.push(server);
  await server.listen();
  return server.resolvedUrls.local[0];
}
try {
  const first = await start("desktop-probe", []);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(first + "probe");
  await page.getByRole("button", { name: "Open dialog" }).waitFor();
  const second = await start("e2e-probe", ["@radix-ui/react-dialog"]);
  const other = await browser.newPage();
  await other.goto(second + "probe");
  await other.getByRole("button", { name: "Open dialog" }).click();
  await other.getByRole("heading", { name: "Dialog ready" }).waitFor();
  await page.getByRole("button", { name: "Open dialog" }).click();
  await page
    .getByRole("heading", { name: "Dialog ready" })
    .waitFor({ timeout: 15000 });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `PASS: ${shared ? "shared" : "isolated"} cache; two concurrent React/Dialog graphs`,
  );
} finally {
  await browser.close();
  await Promise.all(servers.map((server) => server.close()));
  await rm(temporary, { recursive: true, force: true });
}
