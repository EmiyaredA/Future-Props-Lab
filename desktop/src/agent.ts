import { createServer, request, type Server } from "node:http";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Socket } from "node:net";

type Service = { origin: string; token: string };

export class AgentGateway {
  private server?: Server;
  private temporary?: string;
  private sockets = new Set<Socket>();
  private directory: string;
  enabled = false;

  constructor(
    dataDir: string,
    private service: () => Service | undefined,
    private wake: () => void,
  ) {
    this.directory = path.join(dataDir, "agent");
    if (
      existsSync(this.directory) &&
      lstatSync(this.directory).isSymbolicLink()
    )
      throw new Error("Agent 数据目录不能是符号链接");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    try {
      this.enabled =
        JSON.parse(
          readFileSync(path.join(this.directory, "settings.json"), "utf8"),
        ).enabled === true;
    } catch {
      /* Closed by default, including invalid settings. */
    }
  }

  status() {
    return { enabled: this.enabled, connected: Boolean(this.server) };
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.write("settings.json", { enabled });
    if (enabled) await this.start();
    else await this.stop();
    return this.status();
  }

  private write(name: string, value: unknown) {
    const temporary = path.join(this.directory, `${name}.tmp`);
    // Never follow a pre-existing file or link for credential-adjacent metadata.
    rmSync(temporary, { force: true });
    writeFileSync(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path.join(this.directory, name));
  }

  async start() {
    if (!this.enabled || this.server || !this.service()?.origin) return;
    this.temporary = mkdtempSync("/tmp/fpl-agent-");
    chmodSync(this.temporary, 0o700);
    const socketPath = path.join(this.temporary, "app.sock");
    const server = createServer((incoming, outgoing) => {
      const service = this.service();
      const url = incoming.url || "";
      const forbidden = Object.keys(incoming.headers).some(
        (name) =>
          ["cookie", "origin"].includes(name) || name.startsWith("x-fpl-"),
      );
      if (
        !service?.origin ||
        forbidden ||
        !url.startsWith("/v1/") ||
        url.includes("\\") ||
        url.includes("#") ||
        /(?:^|\/)\.\.?(?:\/|$)/.test(url)
      ) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }
      const headers: Record<string, string> = {
        "x-fpl-desktop-token": service.token,
        "x-fpl-agent-channel": "1",
      };
      for (const name of [
        "authorization",
        "content-type",
        "content-length",
        "accept",
        "range",
        "if-none-match",
      ])
        if (typeof incoming.headers[name] === "string")
          headers[name] = incoming.headers[name];
      const upstream = request(
        service.origin + url,
        { method: incoming.method, headers },
        (response) => {
          const safeHeaders = { ...response.headers };
          for (const name of [
            "set-cookie",
            "connection",
            "transfer-encoding",
            "keep-alive",
          ])
            delete safeHeaders[name];
          outgoing.writeHead(response.statusCode || 502, safeHeaders);
          response.pipe(outgoing);
          if (
            incoming.method === "POST" &&
            [201, 202].includes(response.statusCode || 0) &&
            ["/v1/desktop/agent/pairings", "/v1/desktop/ui/open"].includes(url)
          )
            this.wake();
        },
      );
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.on("aborted", () => upstream.destroy());
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    server.on("upgrade", (_request, socket) => socket.destroy());
    server.requestTimeout = 0; // Large uploads and SSE are bounded by their callers.
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    chmodSync(socketPath, 0o600);
    this.server = server;
    this.write("connection.json", {
      version: 1,
      socket_path: socketPath,
      pid: process.pid,
    });
  }

  async stop() {
    rmSync(path.join(this.directory, "connection.json"), { force: true });
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (this.temporary) {
      rmSync(path.join(this.temporary, "app.sock"), { force: true });
      // The directory is created exclusively by this instance and contains only the socket.
      const { rmdirSync } = await import("node:fs");
      rmdirSync(this.temporary);
      this.temporary = undefined;
    }
  }
}
