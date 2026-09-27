import { requestApi } from "@platform/api/client";

export async function streamTurn(
  payload: unknown,
  rpcId: number | string | undefined,
  worker: Worker,
  setAbort: (controller: AbortController | undefined) => void,
) {
  const controller = new AbortController();
  setAbort(controller);
  try {
    const response = await requestApi("/v1/amadeus/model-turn/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型流不可用");
    const decoder = new TextDecoder();
    let buffer = "";
    let result: unknown;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line) as {
          type: string;
          text?: string;
          tool_calls?: unknown[];
          usage?: unknown;
          message?: string;
        };
        if (event.type === "delta")
          worker.postMessage({
            type: "rpc-delta",
            id: rpcId,
            text: event.text || "",
          });
        else if (event.type === "end")
          result = { tool_calls: event.tool_calls, usage: event.usage };
        else if (event.type === "error")
          throw new Error(event.message || "模型调用失败");
      }
    }
    if (!result) throw new Error("模型流提前中断");
    return result;
  } finally {
    setAbort(undefined);
  }
}
