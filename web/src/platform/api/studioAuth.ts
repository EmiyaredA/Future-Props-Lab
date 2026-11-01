export const AUTH_REQUIRED_EVENT = "future-props:auth-required";

export function getCsrfToken(): string {
  const item = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("fpl_csrf="));
  return item ? decodeURIComponent(item.slice("fpl_csrf=".length)) : "";
}

export function applySessionHeaders(request: Request): Request {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    const csrf = getCsrfToken();
    if (csrf) request.headers.set("X-CSRF-Token", csrf);
  }
  return request;
}

export function notifyAuthRequired(): void {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}
