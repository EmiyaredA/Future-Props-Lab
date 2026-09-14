const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer, request } = require("node:http");
const {
  mkdtempSync,
  readFileSync,
  statSync,
  existsSync,
  rmSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { AgentGateway } = require("../dist/agent.js");

test("gateway streams large bodies/SSE, strips browser cookies, and closes on disable", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fpl-gateway-test-"));
  let headers;
  const upstream = createServer((req, res) => {
    headers = req.headers;
    if (req.url.endsWith("stream")) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "set-cookie": "secret=browser",
      });
      res.write("data: one\n\n");
      setTimeout(() => res.end("data: two\n\n"), 5);
    } else req.pipe(res);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const gateway = new AgentGateway(
    root,
    () => ({
      origin: `http://127.0.0.1:${upstream.address().port}`,
      token: "private-start-token",
    }),
    () => {},
  );
  const call = (socketPath, url, body = "", extra = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        { socketPath, path: url, method: "POST", headers: extra },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    assert.equal(gateway.status().enabled, false);
    await gateway.setEnabled(true);
    const descriptor = path.join(root, "agent/connection.json");
    const { socket_path: socketPath } = JSON.parse(readFileSync(descriptor));
    assert.equal(statSync(descriptor).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(socketPath)).mode & 0o777, 0o700);
    assert.equal(
      (await call(socketPath, "/v1/echo", "", { cookie: "bad" })).status,
      403,
    );
    const data = Buffer.alloc(5 * 1024 * 1024, 97);
    assert.deepEqual(
      (
        await call(socketPath, "/v1/echo", data, {
          authorization: "Bearer key",
        })
      ).body,
      data,
    );
    assert.equal(headers["x-fpl-desktop-token"], "private-start-token");
    assert.equal(headers["x-fpl-agent-channel"], "1");
    const stream = await call(socketPath, "/v1/stream");
    assert.equal(stream.body.toString(), "data: one\n\ndata: two\n\n");
    assert.equal(stream.headers["set-cookie"], undefined);
    await gateway.setEnabled(false);
    assert.equal(existsSync(descriptor), false);
    await assert.rejects(call(socketPath, "/v1/echo"));
    await gateway.setEnabled(true);
    assert.notEqual(
      JSON.parse(readFileSync(descriptor)).socket_path,
      socketPath,
    );
  } finally {
    await gateway.stop();
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
