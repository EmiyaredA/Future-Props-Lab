// Only this explicitly loaded extension is exposed to Pi. Personal resources stay disabled.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export default async function fplTools(pi) {
  const config = JSON.parse(process.env.FPL_CLI_MCP_CONFIG || "{}");
  const entries = Object.entries(config.mcpServers || {});
  if (entries.length !== 1) throw new Error("FPL requires one task tool server");
  const [, server] = entries[0];
  const child = spawn(server.command, server.args || [], {
    env: { PATH: process.env.PATH || "/usr/bin:/bin", ...server.env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  let serial = 0;
  let bytes = 0;
  const fail = () => {
    for (const item of pending.values()) item.reject(new Error("FPL tool connection closed"));
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", fail);
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    bytes += Buffer.byteLength(line);
    if (bytes > 16 * 1024 * 1024) { child.kill(); fail(); return; }
    try {
      const message = JSON.parse(line);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error("FPL tool protocol failed"));
      else item.resolve(message.result);
    } catch { child.kill(); fail(); }
  });
  const send = (method, params, notify = false) => {
    const id = ++serial;
    const message = { jsonrpc: "2.0", method, params, ...(!notify && { id }) };
    if (notify) { child.stdin.write(JSON.stringify(message) + "\n"); return; }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(message) + "\n", (error) => {
        if (error) { pending.delete(id); reject(error); }
      });
    });
  };
  const close = () => { child.stdin.end(); child.kill(); fail(); };
  pi.on("session_shutdown", close);
  try {
    await send("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fpl", version: "1" } });
    send("notifications/initialized", {}, true);
    const { tools } = await send("tools/list", {});
    if (!Array.isArray(tools) || !tools.length || tools.length > 100) throw new Error("FPL tool catalog invalid");
    for (const tool of tools) {
      pi.registerTool({
        name: tool.name, label: tool.name, description: tool.description || "FPL task operation",
        parameters: tool.inputSchema,
        async execute(_id, args, signal) {
          if (signal?.aborted) throw new Error("FPL task cancelled");
          const abort = () => close();
          signal?.addEventListener("abort", abort, { once: true });
          try {
            const result = await send("tools/call", { name: tool.name, arguments: args });
            return { content: result.content || [], details: {}, isError: !!result.isError };
          } finally { signal?.removeEventListener("abort", abort); }
        },
      });
    }
    pi.on("session_start", () => pi.setActiveTools(tools.map((tool) => tool.name)));
  } catch (error) { close(); throw error; }
}
