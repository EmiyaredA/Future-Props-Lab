const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const handlers = new Map();
const listeners = new Map();
const original = Module._load;
let selection = { canceled: false, filePaths: ["/private/selected-key"] };
Module._load = function (name, ...args) {
  return name === "electron"
    ? {
        BrowserWindow: { fromWebContents: () => ({}) },
        dialog: {
          showOpenDialog: async () =>
            typeof selection === "function" ? selection() : selection,
        },
        ipcMain: {
          handle: (name, handler) => handlers.set(name, handler),
          on: (name, handler) => listeners.set(name, handler),
        },
      }
    : original.call(this, name, ...args);
};
const { installWebAccess } = require("../dist/web-access.js");
Module._load = original;

test("native access imports are scoped and configuration waits for all window guards", async () => {
  const requests = [];
  const token = "private-native-token";
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      assert.equal(
        req.headers["x-fpl-native-web-access"],
        createHash("sha256")
          .update("web-access:" + token)
          .digest("hex"),
      );
      assert.equal(req.headers.cookie, "fpl_session=session; fpl_csrf=csrf");
      assert.equal(req.headers["x-csrf-token"], "csrf");
      requests.push({ path: req.url, body: JSON.parse(data) });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.endsWith("/claim")
            ? { profile: { host: "gateway.test" } }
            : { id: "a".repeat(32), fingerprint: "SHA256:public" },
        ),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let approve = true;
  let applied = 0;
  const event = {
    sender: {
      id: 1,
      session: {
        cookies: {
          get: async () => [
            { name: "fpl_session", value: "session" },
            { name: "fpl_csrf", value: "csrf" },
            { name: "other", value: "excluded" },
          ],
        },
      },
    },
  };
  const window = {
    webContents: {
      id: 1,
      send: (_name, id) =>
        setImmediate(() =>
          listeners.get("desktop:web-access-approved")(event, id, approve),
        ),
    },
  };
  installWebAccess({
    trusted: (event) => event.sender.id === 1,
    backend: () => ({ origin, token }),
    windows: () => [window],
    apply: async (profile) => {
      assert.equal(profile.profile.host, "gateway.test");
      applied++;
      return true;
    },
  });
  const pick = handlers.get("desktop:web-access-pick");
  const apply = handlers.get("desktop:web-access-apply");
  try {
    await assert.rejects(pick({ sender: { id: 99 } }, "ticket", "identity"));
    const result = await pick(event, "one-use-ticket", "identity");
    assert.deepEqual(result, {
      id: "a".repeat(32),
      fingerprint: "SHA256:public",
    });
    assert.equal(JSON.stringify(result).includes("selected-key"), false);
    assert.equal(requests[0].body.path, "/private/selected-key");
    approve = false;
    await assert.rejects(apply(event, "receipt"));
    assert.equal(applied, 0);
    assert.equal(requests.length, 1);
    approve = true;
    await apply(event, "receipt");
    assert.equal(applied, 1);
    assert.equal(requests.length, 2);
    let resolve;
    selection = () => new Promise((done) => (resolve = done));
    const pending = pick(event, "ticket", "identity");
    await assert.rejects(apply(event, "duplicate"));
    resolve({ canceled: true, filePaths: [] });
    assert.equal(await pending, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
