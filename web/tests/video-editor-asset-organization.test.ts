import { describe, expect, it } from "vitest";
import {
  completeAssetOrganization,
  deleteFolderFromOrganization,
  moveAssetInOrganization,
  moveFolderBefore,
  shiftAssetInOrganization,
  shiftFolderInOrganization,
} from "@features/video-editor/assetOrganization";
import type { VideoEditorAsset } from "@features/video-editor/types";

const assets = ["one", "two", "three"].map(
  (id) =>
    ({
      id,
      displayName: id,
      originalFilename: `${id}.png`,
      mediaKind: "image",
      mimeType: "image/png",
      byteSize: 1,
      processingStatus: "ready",
      probe: {},
      createdAt: "2026-09-08T00:00:00Z",
    }) as VideoEditorAsset,
);

describe("video editor asset organization", () => {
  it("filters stale duplicates and appends newly uploaded assets to root", () => {
    expect(
      completeAssetOrganization(
        {
          folders: [
            { id: "first", name: "First", assetIds: ["one", "stale"] },
            { id: "second", name: "Second", assetIds: ["one"] },
          ],
          rootAssetIds: ["two", "stale"],
        },
        assets,
      ),
    ).toEqual({
      folders: [
        { id: "first", name: "First", assetIds: ["one"] },
        { id: "second", name: "Second", assetIds: [] },
      ],
      rootAssetIds: ["two", "three"],
    });
  });

  it("moves and reorders folders and assets deterministically", () => {
    const initial = completeAssetOrganization(
      {
        folders: [
          { id: "first", name: "First", assetIds: ["one", "two"] },
          { id: "second", name: "Second", assetIds: [] },
        ],
        rootAssetIds: ["three"],
      },
      assets,
    );
    const sortedAssets = shiftAssetInOrganization(initial, "two", -1);
    expect(sortedAssets.folders[0]?.assetIds).toEqual(["two", "one"]);
    const moved = moveAssetInOrganization(sortedAssets, "two", "second");
    expect(moved.folders[1]?.assetIds).toEqual(["two"]);
    const shiftedFolders = shiftFolderInOrganization(moved, "second", -1);
    expect(shiftedFolders.folders.map((folder) => folder.id)).toEqual([
      "second",
      "first",
    ]);
    expect(
      moveFolderBefore(shiftedFolders, "second", "first").folders.map(
        (folder) => folder.id,
      ),
    ).toEqual(["second", "first"]);
  });

  it("returns folder assets to the end of the root order on delete", () => {
    const initial = completeAssetOrganization(
      {
        folders: [{ id: "folder", name: "Folder", assetIds: ["one", "two"] }],
        rootAssetIds: ["three"],
      },
      assets,
    );
    expect(deleteFolderFromOrganization(initial, "folder")).toEqual({
      folders: [],
      rootAssetIds: ["three", "one", "two"],
    });
  });
});
