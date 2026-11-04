"""Reject removal of a live timeline source and remove its organization placement."""

from copy import deepcopy

from .errors import VideoEditorValidationError


def uses_file(document: dict, asset_id: str) -> bool:
    return any(
        clip.get(key) == asset_id
        for track in document.get("tracks", [])
        for clip in track.get("clips", [])
        for key in ("assetId", "fontAssetId")
    )


def without_file(document: dict, asset_id: str) -> dict | None:
    if uses_file(document, asset_id):
        raise VideoEditorValidationError("素材仍被时间轴引用", code="asset_in_use")

    updated = deepcopy(document)
    organization = updated.get("assetOrganization") or {}
    root_asset_ids = organization.get("rootAssetIds") or []
    changed = asset_id in root_asset_ids
    organization["rootAssetIds"] = [item for item in root_asset_ids if item != asset_id]
    for folder in organization.get("folders") or []:
        folder_asset_ids = folder.get("assetIds") or []
        changed |= asset_id in folder_asset_ids
        folder["assetIds"] = [item for item in folder_asset_ids if item != asset_id]
    return updated if changed else None
