import { expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  publishResourceRevision,
  subscribeResourceRevisions,
} from "@platform/sync/resourceBroadcast";
import { invalidateResourceRevision } from "@app/useResourceBroadcastSync";
import { thoughtKeys } from "@features/thought-workshop/queryKeys";
import { presentationKeys } from "@features/presentation-workshop/queryKeys";

test("publish delivers resource revision to subscribers", async () => {
  const received: unknown[] = [];
  const stop = subscribeResourceRevisions((message) => received.push(message));
  publishResourceRevision({
    kind: "thought-note",
    id: "note-1",
    revision: 4,
  });
  await vi.waitFor(() => expect(received).toHaveLength(1));
  expect(received[0]).toEqual({
    kind: "thought-note",
    id: "note-1",
    revision: 4,
  });
  stop();
});

test("invalidateResourceRevision targets owner query keys", () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  invalidateResourceRevision(client, {
    kind: "thought-note",
    id: "note-2",
    revision: 7,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: thoughtKeys.note("note-2"),
  });
  invalidateResourceRevision(client, {
    kind: "presentation-project",
    id: "deck-1",
    revision: 2,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: presentationKeys.project("deck-1"),
  });
});
