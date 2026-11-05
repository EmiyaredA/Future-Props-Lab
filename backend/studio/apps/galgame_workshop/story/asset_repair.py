"""Shared missing-file repair rules for Galgame Story documents."""

from studio.contracts.asset_library.errors import AssetError


def replace_story_file(document, story_asset_id, replacement):
    payload = document.model_dump(mode="json", by_alias=True)
    target = next(
        (asset for asset in payload["assets"] if asset["id"] == story_asset_id),
        None,
    )
    if target is None:
        raise AssetError("故事素材不存在", code="story_asset_not_found", status=404)
    if replacement.media_kind != target["type"]:
        raise AssetError("替换文件类型与故事素材不一致", code="media_kind_mismatch")
    target["fileId"] = replacement.id
    return payload
