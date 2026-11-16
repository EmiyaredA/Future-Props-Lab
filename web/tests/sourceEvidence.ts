import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(process.cwd(), "..");
// Historical references follow explicit relocations, never a missing-file exemption.
const sourceRelocations: Record<string, string> = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "docs/architecture/source-relocations.json"),
    "utf8",
  ),
);

export function sourceEvidenceExists(path: string) {
  return existsSync(resolve(repositoryRoot, sourceRelocations[path] ?? path));
}
