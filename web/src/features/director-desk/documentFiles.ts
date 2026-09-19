const FILE_KEY = /^[a-f0-9]{64}$/;

export function encodeBase64(bytes: Uint8Array): string {
  let value = "";
  for (let start = 0; start < bytes.length; start += 32768) {
    value += String.fromCharCode(...bytes.subarray(start, start + 32768));
  }
  return btoa(value);
}

export function decodeBase64(data: string): Uint8Array {
  const value = atob(data);
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}

function payload(data: string): Uint8Array {
  if (!data.startsWith("data:")) return decodeBase64(data);
  const comma = data.indexOf(",");
  if (comma < 0) throw new Error("内嵌资源无法读取");
  return decodeBase64(data.slice(comma + 1));
}

function shouldExternalize(node: Record<string, unknown>): boolean {
  return (
    typeof node.data === "string" &&
    (node.data.startsWith("data:") || typeof node.path === "string" || node.data.length > 16384)
  );
}

function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return "image/webp";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  return "application/octet-stream";
}

function restore(node: Record<string, unknown>, bytes: Uint8Array): string {
  if (typeof node.path === "string") return encodeBase64(bytes);
  const mime = typeof node.mime === "string" ? node.mime : sniff(bytes);
  if (mime === "application/octet-stream") return encodeBase64(bytes);
  return `data:${mime};base64,${encodeBase64(bytes)}`;
}

async function walk(
  value: unknown,
  visit: (node: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) await walk(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  await visit(node);
  for (const item of Object.values(node)) await walk(item, visit);
}

export async function externalizeTree(
  value: unknown,
  upload: (bytes: Uint8Array) => Promise<string>,
): Promise<unknown> {
  const copy = structuredClone(value);
  await walk(copy, async (node) => {
    if (!shouldExternalize(node) || typeof node.data !== "string") return;
    node.file = await upload(payload(node.data));
    delete node.data;
  });
  return copy;
}

export async function hydrateTree(
  value: unknown,
  download: (key: string) => Promise<Uint8Array>,
): Promise<unknown> {
  const copy = structuredClone(value);
  await walk(copy, async (node) => {
    if (typeof node.file !== "string" || !FILE_KEY.test(node.file) || "data" in node) return;
    const key = node.file;
    node.data = restore(node, await download(key));
    delete node.file;
  });
  return copy;
}
