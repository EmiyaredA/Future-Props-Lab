export type ResourceKind =
  | "thought-note"
  | "presentation-project"
  | "audio-annotation"
  | "galgame-story"
  | "visual-canvas";

export type ResourceRevisionMessage = {
  kind: ResourceKind;
  id: string;
  revision: number;
};

const CHANNEL = "future-props-resource";

export function publishResourceRevision(
  message: ResourceRevisionMessage,
): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(message);
  channel.close();
}

export function subscribeResourceRevisions(
  handler: (message: ResourceRevisionMessage) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("kind" in data) ||
      !("id" in data) ||
      !("revision" in data) ||
      typeof data.kind !== "string" ||
      typeof data.id !== "string" ||
      typeof data.revision !== "number"
    )
      return;
    handler(data as ResourceRevisionMessage);
  };
  return () => channel.close();
}
