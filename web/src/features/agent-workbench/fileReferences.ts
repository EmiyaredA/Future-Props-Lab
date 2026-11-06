export type FileReference = { path: string; line?: number };

// This only creates navigation targets. The server checks ownership, project
// authorization and filesystem boundaries independently on every read.
export function fileReference(value: string): FileReference | undefined {
  let path: string;
  try {
    path = decodeURIComponent(value.trim());
  } catch {
    return;
  }
  if (
    !path ||
    path.startsWith("//") ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  )
    return;
  const match = path.match(/(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/);
  const line = match ? Number(match[1] || match[2]) : undefined;
  if (match) path = path.slice(0, match.index);
  if (path.startsWith("./")) path = path.slice(2);
  if (!/\.[a-z\d]{1,12}$/i.test(path) || path.split("/").includes("..")) return;
  return { path, ...(line && line < 2147483648 ? { line } : {}) };
}

export function commandFiles(text: string): FileReference[] {
  const found = new Map<string, FileReference>();
  for (const match of text.matchAll(
    /(?:^|[\s"'`(=])((?:\.?\.?\/|\/)?[\w@.-]+(?:\/[\w@.+-]+)*\.[a-zA-Z\d]{1,12}(?::\d+)?)(?=$|[\s"'`),;])/g,
  )) {
    const file = fileReference(match[1]);
    // Bare JS member expressions (for example result.value) are not paths.
    if (
      file &&
      /\.(?:[cm]?[jt]sx?|py|rs|go|java|[ch](?:pp)?|cs|swift|kt|rb|php|sh|bash|zsh|fish|css|scss|sass|less|html?|vue|svelte|jsonc?|ya?ml|toml|ini|xml|mdx?|txt|sql|graphql|proto|csv|tsx)$/i.test(
        file.path,
      ) &&
      found.size < 12
    )
      found.set(file.path, file);
  }
  return [...found.values()];
}
