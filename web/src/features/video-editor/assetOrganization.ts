import type {
  VideoEditorAsset,
  VideoEditorAssetFolder,
  VideoEditorAssetOrganization,
} from "./types";

export type CompleteAssetOrganization = {
  folders: (Omit<VideoEditorAssetFolder, "assetIds"> & {
    assetIds: string[];
  })[];
  rootAssetIds: string[];
};

export function completeAssetOrganization(
  organization: VideoEditorAssetOrganization | undefined,
  assets: VideoEditorAsset[],
): CompleteAssetOrganization {
  const known = new Set(assets.map((asset) => asset.id));
  const seen = new Set<string>();
  const folders = (organization?.folders ?? []).map((folder) => ({
    ...folder,
    assetIds: (folder.assetIds ?? []).filter((assetId) => {
      if (!known.has(assetId) || seen.has(assetId)) return false;
      seen.add(assetId);
      return true;
    }),
  }));
  const rootAssetIds = (organization?.rootAssetIds ?? []).filter((assetId) => {
    if (!known.has(assetId) || seen.has(assetId)) return false;
    seen.add(assetId);
    return true;
  });
  for (const asset of assets) {
    if (!seen.has(asset.id)) rootAssetIds.push(asset.id);
  }
  return { folders, rootAssetIds };
}

function withoutAsset(
  organization: CompleteAssetOrganization,
  assetId: string,
): CompleteAssetOrganization {
  return {
    folders: organization.folders.map((folder) => ({
      ...folder,
      assetIds: folder.assetIds.filter((id) => id !== assetId),
    })),
    rootAssetIds: organization.rootAssetIds.filter((id) => id !== assetId),
  };
}

export function moveAssetInOrganization(
  organization: CompleteAssetOrganization,
  assetId: string,
  folderId: string | null,
  beforeAssetId?: string,
): CompleteAssetOrganization {
  if (assetId === beforeAssetId) return organization;
  const next = withoutAsset(organization, assetId);
  const target = folderId
    ? next.folders.find((folder) => folder.id === folderId)?.assetIds
    : next.rootAssetIds;
  if (!target) return organization;
  const beforeIndex = beforeAssetId ? target.indexOf(beforeAssetId) : -1;
  target.splice(beforeIndex < 0 ? target.length : beforeIndex, 0, assetId);
  return next;
}

export function shiftAssetInOrganization(
  organization: CompleteAssetOrganization,
  assetId: string,
  delta: -1 | 1,
): CompleteAssetOrganization {
  const next = structuredClone(organization);
  const lists = [
    ...next.folders.map((folder) => folder.assetIds),
    next.rootAssetIds,
  ];
  const list = lists.find((items) => items.includes(assetId));
  if (!list) return organization;
  const current = list.indexOf(assetId);
  const target = current + delta;
  if (target < 0 || target >= list.length) return organization;
  [list[current], list[target]] = [list[target]!, list[current]!];
  return next;
}

export function shiftFolderInOrganization(
  organization: CompleteAssetOrganization,
  folderId: string,
  delta: -1 | 1,
): CompleteAssetOrganization {
  const folders = organization.folders.map((folder) => ({
    ...folder,
    assetIds: [...folder.assetIds],
  }));
  const current = folders.findIndex((folder) => folder.id === folderId);
  const target = current + delta;
  if (current < 0 || target < 0 || target >= folders.length)
    return organization;
  [folders[current], folders[target]] = [folders[target]!, folders[current]!];
  return { ...organization, folders };
}

export function moveFolderBefore(
  organization: CompleteAssetOrganization,
  folderId: string,
  beforeFolderId: string,
): CompleteAssetOrganization {
  if (folderId === beforeFolderId) return organization;
  const folders = organization.folders.map((folder) => ({
    ...folder,
    assetIds: [...folder.assetIds],
  }));
  const movingIndex = folders.findIndex((folder) => folder.id === folderId);
  if (movingIndex < 0) return organization;
  const [moving] = folders.splice(movingIndex, 1);
  const target = folders.findIndex((folder) => folder.id === beforeFolderId);
  if (!moving || target < 0) return organization;
  folders.splice(target, 0, moving);
  return { ...organization, folders };
}

export function deleteFolderFromOrganization(
  organization: CompleteAssetOrganization,
  folderId: string,
): CompleteAssetOrganization {
  const removed = organization.folders.find((folder) => folder.id === folderId);
  if (!removed) return organization;
  return {
    folders: organization.folders.filter((folder) => folder.id !== folderId),
    rootAssetIds: [...organization.rootAssetIds, ...removed.assetIds],
  };
}
