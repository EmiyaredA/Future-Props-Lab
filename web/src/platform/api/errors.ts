export type ProblemDetail = {
  code?: string;
  detail?: unknown;
  status?: number;
  current?: unknown;
  log_id?: string;
  [key: string]: unknown;
};

export function parseProblemDetail(value: unknown): ProblemDetail {
  return value !== null && typeof value === "object"
    ? (value as ProblemDetail)
    : {};
}

export function problemDetailMessage(
  problem: ProblemDetail,
  fallback = "请求失败，请稍后重试",
): string {
  if (typeof problem.detail === "string" && problem.detail.trim())
    return problem.detail;
  if (problem.detail && typeof problem.detail === "object") {
    const nested = problem.detail as { detail?: unknown; message?: unknown };
    if (typeof nested.detail === "string" && nested.detail.trim())
      return nested.detail;
    if (typeof nested.message === "string" && nested.message.trim())
      return nested.message;
  }
  return fallback;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly problem: ProblemDetail,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function apiErrorMessage(
  error: unknown,
  fallback = "请求失败，请稍后重试",
): string {
  if (error instanceof ApiError)
    return problemDetailMessage(error.problem, error.message || fallback);
  return error instanceof Error && error.message ? error.message : fallback;
}
