import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
} from "node:http";
import type { Socket } from "node:net";
import { credentialHeader } from "./security";

type Service = { origin: string; token: string };

/** A development window retains this origin while its backend is replaced. */
export class DevelopmentGateway {
  readonly token = randomBytes(32).toString("hex");
  origin = "";
  private server?: Server;
  private sockets = new Set<Socket>();
  constructor(
    private vite: string,
    private service: () => Service | undefined,
  ) {
    const url = new URL(vite);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password
    )
      throw new Error("开发页面地址无效");
  }

  private destination(incoming: IncomingMessage) {
    const supplied = Buffer.from(
      String(incoming.headers[credentialHeader.toLowerCase()] || ""),
    );
    const expected = Buffer.from(this.token);
    const url = incoming.url || "";
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      incoming.headers.host !== new URL(this.origin).host ||
      (incoming.headers.origin && incoming.headers.origin !== this.origin) ||
      !url.startsWith("/") ||
      url.startsWith("//") ||
      url.includes("\\")
    )
      return undefined;
    const api = /^\/(v1(?:\/|\?|$)|health(?:\?|$)|ready(?:\?|$))/.test(url);
    const service = this.service();
    const target = api ? service?.origin : this.vite;
    if (!target) return null;
    const headers = { ...incoming.headers };
    for (const name of Object.keys(headers)) {
      if (
        name.startsWith("x-fpl-") ||
        name.startsWith("x-forwarded-") ||
        name === "forwarded"
      )
        delete headers[name];
    }
    headers.host = new URL(target).host;
    if (headers.origin) headers.origin = target;
    if (api) headers[credentialHeader] = service!.token;
    return { target: target + url, headers };
  }

  async start() {
    const server = createServer((incoming, outgoing) => {
      const destination = this.destination(incoming);
      if (!destination) {
        outgoing.writeHead(destination === null ? 503 : 403);
        outgoing.end(destination === null ? "本地服务正在更新" : "Forbidden");
        return;
      }
      const upstream = request(
        destination.target,
        { method: incoming.method, headers: destination.headers },
        (response) => {
          outgoing.writeHead(response.statusCode || 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(503);
        outgoing.end("本地服务暂不可用");
      });
      incoming.on("aborted", () => upstream.destroy());
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    server.on("upgrade", (incoming, socket, head) => {
      const destination = this.destination(incoming);
      if (!destination) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const upstream = request(destination.target, {
        headers: destination.headers,
      });
      upstream.on("upgrade", (response, remote, remoteHead) => {
        const raw = response.rawHeaders;
        const lines = [];
        for (let index = 0; index < raw.length; index += 2)
          lines.push(`${raw[index]}: ${raw[index + 1]}`);
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`,
        );
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.pipe(remote).pipe(socket);
        remote.on("error", () => socket.destroy());
        socket.on("close", () => remote.destroy());
      });
      upstream.on("response", (response) => {
        response.resume();
        socket.destroy();
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      upstream.end();
    });
    server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("开发入口启动失败");
    this.origin = `http://127.0.0.1:${address.port}`;
    this.server = server;
  }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
