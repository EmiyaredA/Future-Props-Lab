import { QueryClient } from "@tanstack/react-query";
import { fileQueryKeys, invalidateFileScope } from "@features/files/queryKeys";

describe("fileQueryKeys", () => {
  test("separates library and project scopes", () => {
    expect(fileQueryKeys.files()).toEqual(["managed-files", "library"]);
    expect(fileQueryKeys.files("project-1")).toEqual([
      "managed-files",
      "project-1",
    ]);
    expect(fileQueryKeys.folders()).toEqual(["managed-folders", "library"]);
    expect(fileQueryKeys.folders("project-1")).toEqual([
      "managed-folders",
      "project-1",
    ]);
  });

  test("includes every list filter in the cache key", () => {
    const base = fileQueryKeys.list({ projectId: "project-1" });
    expect(
      fileQueryKeys.list({ projectId: "project-1", folderId: "folder-1" }),
    ).not.toEqual(base);
    expect(
      fileQueryKeys.list({ projectId: "project-1", query: "cat" }),
    ).not.toEqual(base);
    expect(
      fileQueryKeys.list({ projectId: "project-1", mediaKind: "image" }),
    ).not.toEqual(base);
    expect(
      fileQueryKeys.list({ projectId: "project-1", sort: "name" }),
    ).not.toEqual(base);
    expect(
      fileQueryKeys.list({
        projectId: "project-1",
        includeReferences: true,
      }),
    ).not.toEqual(base);
  });

  test("invalidates only the requested scope", async () => {
    const client = new QueryClient();
    const projectFiles = fileQueryKeys.list({ projectId: "project-1" });
    const projectFolders = fileQueryKeys.folders("project-1");
    const libraryFiles = fileQueryKeys.list({});
    const libraryFolders = fileQueryKeys.folders();
    for (const key of [
      projectFiles,
      projectFolders,
      libraryFiles,
      libraryFolders,
    ]) {
      client.setQueryData(key, { items: [] });
    }

    await invalidateFileScope(client, "project-1", { folders: true });

    expect(client.getQueryState(projectFiles)?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectFolders)?.isInvalidated).toBe(true);
    expect(client.getQueryState(libraryFiles)?.isInvalidated).toBe(false);
    expect(client.getQueryState(libraryFolders)?.isInvalidated).toBe(false);
  });
});
