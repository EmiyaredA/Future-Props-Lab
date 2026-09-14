const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
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
