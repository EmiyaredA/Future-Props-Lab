export const credentialHeader = "X-FPL-Desktop-Token";

export function isServiceUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "ws:") url.protocol = "http:";
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function externalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
