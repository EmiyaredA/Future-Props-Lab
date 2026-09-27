import { fetchApiJson } from "@platform/api/client";
import type { RunDetail } from "./protocol";

export function createRunEventRecorder(
  conversationId: string,
  runId: string,
  onSaved: (event: RunDetail["events"][number]) => void,
) {
  let eventIndex = 0;
  let persistence = Promise.resolve();
  return {
    append(kind: string, payload: Record<string, unknown>) {
      const idempotencyKey = `${kind}-${++eventIndex}`;
      persistence = persistence.then(async () => {
        const saved = await fetchApiJson<RunDetail["events"][number]>(
          `/v1/amadeus/conversations/${conversationId}/runs/${runId}/events`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind,
              payload,
              idempotency_key: idempotencyKey,
            }),
          },
        );
        onSaved(saved);
      });
      return persistence;
    },
    wait() {
      return persistence;
    },
  };
}
