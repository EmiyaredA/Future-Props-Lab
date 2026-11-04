"""Read the original kinds of an exact set of account-owned Video project files."""

import re

from pydantic import Field

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/video-editor"
PREFIX = "/_internal/v1/video-project-assets"
PURPOSE = "video.project-assets.read"
MAX_IDS = 64


class VideoAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("剪辑项目标识无效")
        return f"{PREFIX}/{project_id}/metadata/{self.digest}"


def video_asset_grant(grant):
    if (
        grant.caller,
        grant.purpose,
        grant.target_service,
        grant.source_method,
        grant.target_method,
    ) != ("video", PURPOSE, "assets", "POST", "GET"):
        return False
    source = re.fullmatch(rf"{SOURCE}/projects/({ID})/timeline/operations", grant.source_path)
    return bool(
        source and re.fullmatch(rf"{PREFIX}/{source[1]}/metadata/[0-9a-f]{{64}}", grant.target_path)
    )


class VideoAsset(LibraryAssetDescription):
    pass
