import { fetchApiJson } from "@platform/api/client";
import type { SavedQuestion } from "./protocol";

export function submitAmadeusAnswer(
  conversationId: string,
  question: SavedQuestion,
  answer: string,
  note: string,
) {
  return fetchApiJson<SavedQuestion>(
    `/v1/amadeus/conversations/${conversationId}/questions/${question.id}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer, note }),
    },
  );
}
