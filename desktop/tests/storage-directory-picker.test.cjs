const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const handlers = new Map();
const window = {};
let result = { canceled: false, filePaths: ["/test/中文 目录"] };
let calls = 0;
const original = Module._load;
Module._load = function (name, ...args) {
  return name === "electron"
    ? {
        BrowserWindow: { fromWebContents: () => window },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        dialog: {
          showOpenDialog: async (parent, options) => {
            calls++;
            assert.equal(parent, window);
            assert.deepEqual(options.properties, [
              "openDirectory",
              "showHiddenFiles",
            ]);
            return typeof result === "function" ? result() : result;
          },
        },
      }
    : original.call(this, name, ...args);
};
const {
  installStorageDirectoryPicker,
} = require("../dist/storage-directory-picker.js");
Module._load = original;
installStorageDirectoryPicker((event) => event.sender.id === 1);
const pick = handlers.get("desktop:storage-pick-directory");
test(
  "directory picker validates sender, handles selection, cancel and duplicate calls",
  { skip: process.platform !== "darwin" },
  async () => {
    await assert.rejects(pick({ sender: { id: 2 } }));
    assert.equal(calls, 0);
    assert.equal(await pick({ sender: { id: 1 } }), "/test/中文 目录");
    result = { canceled: true, filePaths: [] };
    assert.equal(await pick({ sender: { id: 1 } }), null);
    let resolve;
    result = () =>
      new Promise((done) => {
        resolve = done;
      });
    const pending = pick({ sender: { id: 1 } });
    await assert.rejects(pick({ sender: { id: 1 } }));
    resolve({ canceled: true, filePaths: [] });
    await pending;
    result = () => {
      throw new Error("dialog failed");
    };
    await assert.rejects(pick({ sender: { id: 1 } }));
    result = { canceled: true, filePaths: [] };
    assert.equal(await pick({ sender: { id: 1 } }), null);
  },
);
