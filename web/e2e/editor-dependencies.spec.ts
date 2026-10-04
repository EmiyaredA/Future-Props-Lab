import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

test("desktop deferred reloads keep one React when lazy editor dependencies load", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const repository = resolve("..");
  const output = join(repository, ".local/react-recovery");
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, "dependency-probe-"));
  await writeFile(
    join(root, "index.html"),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  await writeFile(
    join(root, "main.tsx"),
    `import * as React from "react";
import {createRoot} from "react-dom/client";
window.ReactBefore=React;
window.probeRoot=createRoot(document.getElementById("root"));
window.probeRoot.render(React.createElement("p",null,"ready"));`,
  );
  const server = await createServer({
    configFile: join(repository, "web/vite.config.ts"),
    mode: "desktop",
    root,
    cacheDir: join(root, "node_modules/.vite"),
    optimizeDeps: { entries: ["index.html"] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repository] } },
  });
  const send = server.environments.client.hot.send.bind(
    server.environments.client.hot,
  );
  // Match the desktop supervisor: full reload waits for the unsaved-change guard.
  server.environments.client.hot.send = (payload, ...rest) => {
    if (typeof payload === "object" && payload.type === "full-reload") return;
    send(payload, ...rest);
  };
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("Missing probe listener");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByText("ready", { exact: true })).toBeVisible();
    const late = `import * as React from "react";
import CodeBlock from "@tiptap/extension-code-block";
import {createLowlight, common} from "lowlight";
window.ReactAfter=React;
const scope=React.createContext("working");
function Probe(){return React.createElement("p",null,React.useContext(scope));}
export function render(){window.probeRoot.render(React.createElement(Probe));
window.dependenciesReady=!!CodeBlock&&!!createLowlight(common);}`;
    await writeFile(join(root, "late.tsx"), late);
    await page.evaluate(async () => {
      const component = await import(/* @vite-ignore */ "/late.tsx");
      component.render();
    });
    await expect(page.getByText("working", { exact: true })).toBeVisible();
    // Wait for the optimizer's batch so a second module sees the final dependency graph.
    await expect
      .poll(async () => {
        const metadata = JSON.parse(
          await readFile(
            join(root, "node_modules/.vite/deps/_metadata.json"),
            "utf8",
          ),
        );
        return (
          !!metadata.optimized["@tiptap/extension-code-block"] &&
          !!metadata.optimized.lowlight
        );
      })
      .toBeTruthy();
    await writeFile(join(root, "late-second.tsx"), late);
    await page.evaluate(async () => {
      const component = await import(/* @vite-ignore */ "/late-second.tsx");
      component.render();
    });
    await expect(page.getByText("working", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const probe = window as unknown as {
          ReactBefore: { useContext: unknown };
          ReactAfter: { useContext: unknown };
          dependenciesReady: boolean;
        };
        return (
          probe.dependenciesReady &&
          probe.ReactBefore.useContext === probe.ReactAfter.useContext
        );
      }),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server.close();
  }
});
