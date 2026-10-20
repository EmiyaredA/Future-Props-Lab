const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("closing a Studio detaches its pet without reading the destroyed BrowserWindow", () => {
  // Exercise the real compiled callback without starting Electron's app entrypoint.
  const source = readFileSync(path.join(__dirname, "../dist/main.js"), "utf8");
  const start = source.indexOf("function trackStudio(win)");
  const end = source.indexOf("function availableContexts()", start);
  assert.ok(start >= 0 && end > start);
  const detached = [];
  const context = vm.createContext({
    studioWindows: new Set(),
    focusedStudio: undefined,
    queueAmadeusAlwaysOnTopSync() {},
    amadeusWindow: undefined,
    petController: { detachStudio: (id) => detached.push(id) },
  });
  vm.runInContext(source.slice(start, end), context);
  const window = new EventEmitter();
  let destroyed = false;
  Object.defineProperty(window, "webContents", {
    get() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return { id: 42 };
    },
  });
  context.trackStudio(window);
  destroyed = true;
  assert.doesNotThrow(() => window.emit("closed"));
  assert.deepEqual(detached, [42]);
});

test("opening another Studio returns a cloneable IPC result", () => {
  const source = readFileSync(path.join(__dirname, "../dist/main.js"), "utf8");
  const match = source.match(
    /"open-new-window": \(win\) => \{([\s\S]*?)\n\s*\},/,
  );
  assert.ok(match);
  const opened = [];
  const context = vm.createContext({
    state: { phase: "ready" },
    quitting: false,
    presentation_windows_1: {
      studioPathForNewWindow: () => "/apps/desktop-pet",
    },
    pageOrigin: () => "http://localhost:9000",
    openStudioWindow: (url) => {
      opened.push(url);
      return { uncloneable: () => {} };
    },
  });
  const result = vm.runInContext(
    `((win) => {${match[1]}})({webContents:{getURL:()=>"http://localhost:9000"}})`,
    context,
  );
  assert.equal(result, undefined);
  assert.doesNotThrow(() => structuredClone(result));
  assert.deepEqual(opened, ["/apps/desktop-pet"]);
});
