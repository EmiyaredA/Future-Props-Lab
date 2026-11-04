"""Revision-independent identity and digest checks for owned Motion project files."""

import re

from pydantic import Field

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/motion-compositor"
PREFIX = "/_internal/v1/motion-project-assets"
PURPOSE = "motion.project-assets.read"
MAX_IDS = 64


class MotionAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("特效项目标识无效")
        return f"{PREFIX}/{project_id}/{self.digest}"


class MotionAsset(LibraryAssetDescription):
    pass


def motion_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.target_method) != (
        "motion",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    source = re.fullmatch(rf"{SOURCE}/projects/({ID})/document/operations", grant.source_path)
    target = re.fullmatch(rf"{PREFIX}/({ID})/[0-9a-f]{{64}}", grant.target_path)
    return bool(grant.source_method == "POST" and source and target and source[1] == target[1])
