import type { ChatMessage, RunDetail } from "./protocol";

export type AgentHistoryItem = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_call_id?: string;
  tool_name?: string;
};

export function buildAgentHistory(
  messages: ChatMessage[],
  runs: RunDetail[],
): AgentHistoryItem[] {
  const runsById = new Map(runs.map((item) => [item.run.id, item.events]));
  return messages.flatMap((message) => {
    const transcript: AgentHistoryItem[] = [];
    if (message.role === "assistant" && message.run_id) {
      for (const event of runsById.get(message.run_id) || []) {
        if (event.kind === "tool_call") {
          const id = String(
            event.payload.tool_call_id || event.payload.action_id || "unknown",
          );
          transcript.push({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id,
                name: String(event.payload.tool_name || "tool"),
                arguments:
                  event.payload.arguments &&
                  typeof event.payload.arguments === "object"
                    ? (event.payload.arguments as Record<string, unknown>)
                    : {},
              },
            ],
          });
        } else if (event.kind === "tool_result") {
          transcript.push({
            role: "tool",
            content: JSON.stringify(event.payload.result ?? event.payload),
            tool_call_id: String(event.payload.tool_call_id || "unknown"),
            tool_name: String(event.payload.name || "tool"),
          });
        }
      }
    }
    transcript.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content:
        message.content +
        (message.references?.length
          ? `\n[当时引用] ${message.references.map((item) => `${item.application}/${item.name}: ${item.value}`).join("; ")}`
          : ""),
    });
    return transcript;
  });
}
