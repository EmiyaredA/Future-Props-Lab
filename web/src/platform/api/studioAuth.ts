const KEY = "future_props_studio_token";
export const AUTH_REQUIRED_EVENT = "future-props:auth-required";

export function getStudioToken(): string {
  try {
    return sessionStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setStudioToken(value: string): void {
  sessionStorage.setItem(KEY, value.trim());
}

export function clearStudioToken(): void {
  sessionStorage.removeItem(KEY);
}

export function notifyAuthRequired(): void {
  clearStudioToken();
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}
