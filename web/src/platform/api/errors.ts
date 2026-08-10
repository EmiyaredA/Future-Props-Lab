export type ProblemDetail = {
  code?: string;
  detail?: string;
  status?: number;
  current?: unknown;
  log_id?: string;
  [key: string]: unknown;
};

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
  return error instanceof Error ? error.message : fallback;
}
