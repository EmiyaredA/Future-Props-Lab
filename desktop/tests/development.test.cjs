const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");
const { DevelopmentGateway } = require("../dist/development-gateway.js");
const { credentialHeader } = require("../dist/security.js");

async function service(t, handler) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    token: "private-backend-fixture",
  };
}

test("stable gateway checks credentials/Origin, preserves cookie and CSRF, switches backend without changing origin", async (t) => {
  const backend = await service(t, (req, res) => {
    res.setHeader(
      "Set-Cookie",
      "session=fixture; HttpOnly; Path=/; SameSite=Lax",
    );
    res.end(JSON.stringify(req.headers));
  });
  const vite = await service(t, (req, res) =>
    res.end(JSON.stringify(req.headers)),
  );
  let current = backend;
  const gateway = new DevelopmentGateway(vite.origin, () => current);
  await gateway.start();
  t.after(() => gateway.stop());
  const origin = gateway.origin;
  const headers = {
    [credentialHeader]: gateway.token,
    Origin: origin,
    Cookie: "session=fixture",
    "X-CSRF-Token": "csrf-fixture",
    "X-FPL-Agent-Channel": "spoofed",
  };
  assert.equal((await fetch(origin + "/v1/check")).status, 403);
  assert.equal(
    (
      await fetch(origin + "/v1/check", {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const response = await fetch(origin + "/v1/check", { headers });
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const received = await response.json();
  assert.equal(received[credentialHeader.toLowerCase()], backend.token);
  assert.equal(received.host, new URL(backend.origin).host);
  assert.equal(received.origin, backend.origin);
  assert.equal(received.cookie, "session=fixture");
  assert.equal(received["x-csrf-token"], "csrf-fixture");
  assert.equal(received["x-fpl-agent-channel"], undefined);
  const page = await (
    await fetch(origin + "/@vite/client", { headers })
  ).json();
  assert.equal(page[credentialHeader.toLowerCase()], undefined);
  current = undefined;
  assert.equal((await fetch(origin + "/ready", { headers })).status, 503);
  current = await service(t, (_req, res) => res.end("replacement"));
  assert.equal(
    await (await fetch(origin + "/v1/check", { headers })).text(),
    "replacement",
  );
  assert.equal(gateway.origin, origin);
});

test("streams large uploads, SSE and both HMR/business WebSockets", async (t) => {
  const backend = await service(t, (req, res) => {
    if (req.url === "/v1/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: done\n\n"), 30);
    } else req.pipe(res);
  });
  const vite = await service(t, (_req, res) => res.end("page"));
  for (const target of [backend, vite]) {
    const ws = new WebSocketServer({ server: target.server });
    ws.on("connection", (socket, req) => {
      assert.equal(
        req.headers[credentialHeader.toLowerCase()],
        target === backend ? backend.token : undefined,
      );
      socket.on("message", (message) => socket.send(message));
    });
    t.after(() => ws.close());
  }
  const gateway = new DevelopmentGateway(vite.origin, () => backend);
  await gateway.start();
  t.after(() => gateway.stop());
  const headers = { [credentialHeader]: gateway.token, Origin: gateway.origin };
  const body = "x".repeat(5 * 1024 * 1024);
  assert.equal(
    await (
      await fetch(gateway.origin + "/v1/upload", {
        method: "POST",
        headers,
        body,
      })
    ).text(),
    body,
  );
  const events = await fetch(gateway.origin + "/v1/events", { headers });
  const reader = events.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  assert.match(new TextDecoder().decode((await reader.read()).value), /done/);
  for (const route of ["/v1/realtime", "/?token=vite-test"]) {
    const socket = new WebSocket(
      gateway.origin.replace("http:", "ws:") + route,
      { headers },
    );
    await once(socket, "open");
    socket.send("fixture");
    assert.equal((await once(socket, "message"))[0].toString(), "fixture");
    socket.close();
    await once(socket, "close");
  }
});

test("packaging excludes source supervisors, snapshots and secrets", () => {
  const { packagerConfig } = require("../forge.config.cjs");
  for (const file of [
    "/.dev-run-abc/main.js",
    "/.dev-pending/main.js",
    "/scripts/dev.cjs",
    "/backend/config.toml",
    "/development/last-success-config.toml",
  ])
    assert.equal(packagerConfig.ignore(file), true);
});
