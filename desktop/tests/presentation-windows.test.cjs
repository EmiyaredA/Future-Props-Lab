const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const handlers = new Map();
let parent;
const original = Module._load;
Module._load = function (name, ...args) {
  return name === "electron"
    ? {
        BrowserWindow: { fromWebContents: () => parent },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      }
    : original.call(this, name, ...args);
};
const {
  presentationAudiencePath,
  installPresentationWindows,
  studioPathForNewWindow,
} = require("../dist/presentation-windows.js");
Module._load = original;
const session = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
test("观众窗口限定应用路径并拒绝地址注入", () => {
  assert.equal(
    presentationAudiencePath("project-1", session),
    `/apps/presentation-workshop/projects/project-1?presentationAudience=${session}`,
  );
  for (const id of ["../x", "https://evil.test", "a?b", "", null])
    assert.throws(() => presentationAudiencePath(id, session));
  assert.throws(() => presentationAudiencePath("x", "wrong"));
  assert.equal(
    studioPathForNewWindow("https://evil.test/a", "http://localhost:9000"),
    "/",
  );
});
test("可信请求只保留一个观众窗口，父窗口结束时清理", async () => {
  parent = new EventEmitter();
  const created = [],
    tracked = new Set();
  installPresentationWindows({
    trusted: (event) => event.sender.id === 1,
    origin: () => "http://localhost:9000",
    track: (w) => tracked.add(w),
    untrack: (w) => tracked.delete(w),
    create: () => {
      const win = new EventEmitter();
      win.isDestroyed = () => !!win.closed;
      win.close = () => {
        win.closed = true;
        win.emit("closed");
      };
      win.loadURL = async (url) => {
        win.url = url;
      };
      created.push(win);
      return win;
    },
  });
  const open = handlers.get("desktop:presentation-audience");
  await assert.rejects(open({ sender: { id: 2 } }, "project", session));
  assert.equal(created.length, 0);
  await open({ sender: { id: 1 } }, "project", session);
  assert.equal(tracked.size, 1);
  await open({ sender: { id: 1 } }, "project", session);
  assert.equal(created[0].closed, true);
  assert.equal(tracked.size, 1);
  assert.doesNotThrow(() => parent.emit("closed"));
  assert.equal(created[1].closed, true);
  assert.equal(tracked.size, 0);
});
