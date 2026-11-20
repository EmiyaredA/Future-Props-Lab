// First release uses the manual editor. No browser speech service or model credentials.
export { z } from "zod";

export function isBrowserAsrSupported() {
  return false;
}

export function createBrowserAsr() {
  throw new Error("此工作区未启用语音输入");
}
