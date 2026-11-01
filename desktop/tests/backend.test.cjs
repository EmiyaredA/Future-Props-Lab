const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { createServer } = require("node:http");
const { Backend } = require("../dist/backend.js");

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fpl-desktop-unit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
  });
  t.mock.method(childProcess, "spawn", () => child);
  return {
    child,
    backend: new Backend(directory, true, directory, () => undefined),
  };
}

test("startup timeout rejects explicitly, credential is sent only to stdin", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { backend, child } = fixture(t);
  const started = backend.start();
  const rejection = assert.rejects(started, /启动超时/);
  assert.equal(child.stdin.read().toString(), backend.token + "\n");
  assert.equal(
    childProcess.spawn.mock.calls[0].arguments[1].includes(backend.token),
    false,
  );
  t.mock.timers.tick(90_001);
  await rejection;
});

test("malformed private handshake is rejected", async (t) => {
  const { backend, child } = fixture(t);
  const rejection = assert.rejects(backend.start(), /握手无效/);
  child.stdout.write('{"port":70000}\n');
  await rejection;
});

test("missing child executable reports a safe Chinese error", async (t) => {
  const { backend, child } = fixture(t);
  const rejection = assert.rejects(backend.start(), /无法启动本地服务/);
  child.emit("error", new Error("Sensitive implementation details"));
  await rejection;
});

test("maintenance opens the authenticated upgrade UI without accepting other readiness failures", async (t) => {
  const { backend } = fixture(t);
  let status = 503;
  let body = JSON.stringify({ code: "account_storage_upgrade_required" });
  const server = createServer((request, response) => {
    assert.equal(request.url, "/ready");
    assert.equal(request.headers["x-fpl-desktop-token"], backend.token);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  backend.origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await backend.ready(), true);
  body = JSON.stringify({ code: "storage_unavailable" });
  assert.equal(await backend.ready(), false);
  body = "not json";
  assert.equal(await backend.ready(), false);
  status = 403;
  body = JSON.stringify({ code: "account_storage_upgrade_required" });
  assert.equal(await backend.ready(), false);
  status = 200;
  assert.equal(await backend.ready(), true);
});
