/** Program resources belong to the current application build, independently of Portal. */
export function programAsset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
