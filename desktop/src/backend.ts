import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { credentialHeader } from "./security";

export class Backend {
  readonly token = randomBytes(32).toString("hex");
  origin = "";
  configDigest = "";
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;
  constructor(
    private dataDir: string,
    private packaged: boolean,
    private resources: string,
    private onCrash: () => void,
    private developmentLease?: number,
  ) {}

  async start(webConfig?: unknown): Promise<void> {
    const root = path.resolve(__dirname, "../..");
    const logs = path.join(this.dataDir, "logs");
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    const executable = this.packaged
      ? path.join(this.resources, "fpl-server/fpl-server")
      : path.join(root, ".venv/bin/python");
    const args = this.packaged
      ? []
      : [path.join(root, "desktop/backend/entry.py")];
    args.push(
      "--data-dir",
      this.dataDir,
      "--web-dir",
      this.packaged
        ? path.join(this.resources, "dist")
        : path.join(root, "web/dist"),
    );
    if (!this.packaged && this.developmentLease !== undefined)
      args.push("--development-lock-fd", "3");
    if (webConfig) args.push("--apply-web-config");
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (
        key.startsWith("FPL_") ||
        key.startsWith("PYTHON") ||
        key.startsWith("DYLD_") ||
        key === "CORS_ORIGINS"
      )
        delete env[key];
    }
    this.child = spawn(executable, args, {
      cwd: this.dataDir,
      env,
      stdio:
        this.developmentLease === undefined
          ? "pipe"
          : ["pipe", "pipe", "pipe", this.developmentLease],
      detached: true,
    }) as ChildProcessWithoutNullStreams;
    const child = this.child;
    child.stdin.on("error", () => undefined);
    child.stderr.on("data", (chunk: Buffer) => {
      appendFileSync(path.join(logs, "backend.log"), chunk, { mode: 0o600 });
    });
    const port = await new Promise<number>((resolve, reject) => {
      let received = "";
      const timeout = setTimeout(
        () => reject(new Error("本地服务启动超时，请查看日志后重试")),
        webConfig ? 900_000 : 90_000,
      );
      const finish = () => clearTimeout(timeout);
      child.once("error", () => {
        finish();
        reject(new Error("无法启动本地服务，请检查应用资源是否完整"));
      });
      child.once("exit", () => {
        finish();
        reject(
          new Error("本地服务启动失败；请检查日志及 backend/config.toml 密钥"),
        );
      });
      child.stdout.on("data", (chunk: Buffer) => {
        received += chunk.toString();
        if (received.length > 4096) {
          finish();
          reject(new Error("本地服务握手无效"));
          return;
        }
        if (!received.includes("\n")) return;
        try {
          const value = JSON.parse(received.split("\n")[0]) as {
            port: number;
            config_digest?: string;
          };
          if (
            !Number.isInteger(value.port) ||
            value.port < 1 ||
            value.port > 65535
          )
            throw new Error();
          finish();
          if (
            typeof value.config_digest === "string" &&
            /^[a-f0-9]{64}$/.test(value.config_digest)
          )
            this.configDigest = value.config_digest;
          resolve(value.port);
        } catch {
          finish();
          reject(new Error("本地服务握手无效"));
        }
      });
      child.stdin.write(`${this.token}\n`);
      if (webConfig) child.stdin.write(`${JSON.stringify(webConfig)}\n`);
    });
    this.origin = `http://127.0.0.1:${port}`;
    child.once("exit", () => {
      if (!this.stopping) {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          /* Group already exited. */
        }
        this.onCrash();
      }
    });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("本地服务已停止，请查看日志");
      if (await this.ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("本地服务就绪超时，请查看日志后重试");
  }

  private ready(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = request(
        `${this.origin}/ready`,
        { headers: { [credentialHeader]: this.token }, timeout: 1500 },
        (res) => {
          if (res.statusCode !== 503) {
            res.resume();
            resolve(res.statusCode === 200);
            return;
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          res.on("error", () => resolve(false));
          res.on("end", () => {
            try {
              resolve(
                JSON.parse(body).code === "account_storage_upgrade_required",
              );
            } catch {
              resolve(false);
            }
          });
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child?.pid) return;
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* Already exited. */
          }
          resolve();
        }, 17_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.stdin.end();
      });
    }
    // Kill only this child's private process group, including media subprocesses.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Group is already gone. */
    }
    this.child = undefined;
  }
}
