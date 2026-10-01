import { ApiError } from "@platform/api/client";
import type { Conversation } from "./protocol";

export function conversationConflict(error: unknown): Conversation | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 409 ||
    error.problem.code !== "revision_conflict"
  )
    return null;
  const current = error.problem.current;
  if (
    !current ||
    typeof current !== "object" ||
    !("id" in current) ||
    !("revision" in current)
  )
    return null;
  return current as Conversation;
}

export const CONVERSATION_CONFLICT_MESSAGE =
  "会话已在其他位置更新。已读取最新内容，请确认后重新提交；本次输入已保留。";
