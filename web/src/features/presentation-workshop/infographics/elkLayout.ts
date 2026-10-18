import type { ElkNode } from "elkjs/lib/elk-api";

export async function layoutGraph(graph: ElkNode): Promise<ElkNode> {
  const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
    import("elkjs/lib/elk-api.js"),
    import("elkjs/lib/elk-worker.min.js?url"),
  ]);
  const engine = new ELK({ workerUrl, algorithms: ["layered"] });
  try {
    return await engine.layout(graph);
  } finally {
    engine.terminateWorker();
  }
}
