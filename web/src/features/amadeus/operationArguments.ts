export function normalizeOperationBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("业务操作的 body 必须是 JSON 对象，不能是未解析的字符串");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("业务操作的 body 必须是 JSON 对象");
  return parsed;
}
