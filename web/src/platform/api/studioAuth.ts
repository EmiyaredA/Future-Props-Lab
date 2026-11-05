export const AUTH_REQUIRED_EVENT = "future-props:auth-required";

export function getCsrfToken(): string {
  const name =
    import.meta.env.VITE_FPL_SERVICE === "management"
      ? "fpl_management_csrf="
      : "fpl_csrf=";
  const item = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name));
  return item ? decodeURIComponent(item.slice(name.length)) : "";
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
