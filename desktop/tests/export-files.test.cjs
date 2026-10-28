const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const Module = require("node:module");
const handlers = new Map();
let directory, destination, showSave, failRename, shown;
const parent = {};
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "electron")
    return {
      app: { getPath: () => directory },
      BrowserWindow: { fromWebContents: () => parent },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showSaveDialog: (...args) => showSave(...args) },
      shell: {
        showItemInFolder: (file) => {
          shown = file;
        },
      },
    };
  if (name === "node:fs/promises")
    return {
      ...fs,
      rename: async (...args) => {
        if (failRename) throw new Error("磁盘写入失败");
        return fs.rename(...args);
      },
    };
  return original.call(this, name, ...args);
};
const { installExportFiles } = require("../dist/export-files.js");
Module._load = original;
const downloadSession = new EventEmitter();
installExportFiles((event) => event.trusted === true, downloadSession);
const save = handlers.get("desktop:export-save");
const reveal = handlers.get("desktop:export-reveal");
function event(id = 1) {
  const sender = new EventEmitter();
  sender.id = id;
  sender.isDestroyed = () => false;
  return { trusted: true, sender };
}
before(async () => {
  const root = path.resolve(__dirname, "../../.local/presentation-export");
  await fs.mkdir(root, { recursive: true });
  directory = await fs.mkdtemp(path.join(root, "unit-"));
});
after(async () => fs.rm(directory, { recursive: true, force: true }));
beforeEach(() => {
  failRename = false;
  shown = undefined;
  destination = path.join(directory, "交付.pptx");
  showSave = async () => ({ canceled: false, filePath: destination });
});

test("save waits for a native destination and returns a receipt after writing all bytes", async () => {
  const owner = event();
  const bytes = new Uint8Array([80, 75, 3, 4]);
  showSave = async (window, options) => {
    assert.equal(window, parent);
    assert.equal(options.defaultPath, path.join(directory, "导出.pptx"));
    assert.deepEqual(options.filters[0].extensions, ["pptx"]);
    return { canceled: false, filePath: destination };
  };
  const result = await save(owner, "导出.pptx", bytes);
  assert.equal(result.path, destination);
  assert.deepEqual(await fs.readFile(destination), Buffer.from(bytes));
  await reveal(owner, result.id);
  assert.equal(shown, destination);
  assert.throws(() => reveal(event(2), result.id));
  assert.throws(() => reveal(owner, "/arbitrary/path"));
  owner.sender.emit("destroyed");
  assert.throws(() => reveal(owner, result.id));
});

test("canceling does not create or overwrite a file", async () => {
  await fs.writeFile(destination, "original");
  showSave = async () => ({ canceled: true });
  assert.equal(await save(event(), "deck.pptx", new Uint8Array([1])), null);
  assert.equal(await fs.readFile(destination, "utf8"), "original");
});

test("untrusted requests and invalid filenames or payloads never open a dialog", async () => {
  let called = 0;
  showSave = async () => {
    called++;
    return { canceled: true };
  };
  await assert.rejects(
    save({ ...event(), trusted: false }, "x.pptx", new Uint8Array([1])),
  );
  assert.throws(() => reveal({ ...event(), trusted: false }, "x"));
  for (const filename of [
    "../x.pptx",
    "C:\\x.pptx",
    "x.exe",
    "x\u0000.pptx",
    "",
    null,
  ])
    await assert.rejects(save(event(), filename, new Uint8Array([1])));
  for (const bytes of [null, "content", [1], new Uint8Array()])
    await assert.rejects(save(event(), "x.pptx", bytes));
  assert.equal(called, 0);
});

test("one window cannot open duplicate save dialogs", async () => {
  let finish;
  showSave = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const owner = event();
  const pending = save(owner, "deck.pptx", new Uint8Array([1]));
  await assert.rejects(
    save(owner, "deck.pptx", new Uint8Array([1])),
    /正在保存/,
  );
  finish({ canceled: true });
  await pending;
  showSave = async () => ({ canceled: true });
  assert.equal(await save(owner, "deck.pptx", new Uint8Array([1])), null);
});

test("failed replacement preserves the existing file, cleans temporary bytes and allows retry", async () => {
  await fs.writeFile(destination, "original");
  failRename = true;
  const owner = event();
  await assert.rejects(
    save(owner, "deck.pptx", new Uint8Array([1, 2])),
    /磁盘写入失败/,
  );
  assert.equal(await fs.readFile(destination, "utf8"), "original");
  assert.equal(
    (await fs.readdir(directory)).some((name) => name.endsWith(".tmp")),
    false,
  );
  failRename = false;
  const result = await save(owner, "deck.pptx", new Uint8Array([1, 2]));
  assert.equal(result.path, destination);
  assert.deepEqual(await fs.readFile(destination), Buffer.from([1, 2]));
});
