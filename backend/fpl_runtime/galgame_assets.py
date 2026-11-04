"""Digest-bound reads of one Galgame project's file projection."""

import re
from datetime import datetime

from pydantic import Field

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/galgame-workshop/projects"
PREFIX = "/_internal/v1/galgame-project-assets"
PURPOSE = "galgame.project-assets.read"
MAX_QUERY_BYTES = 2 * 1024 * 1024


class GalgameAssetQuery(LibraryAssetQuery):
    search: str = Field(default="", max_length=255)
    newest_first: bool = False

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("Galgame 项目标识无效")
        return f"{PREFIX}/{project_id}/{self.digest}"


class GalgameAssetFile(LibraryAssetDescription):
    display_name: str
    created_at: datetime
    updated_at: datetime
    exists: bool


def asset_query_target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{PREFIX}/({ID})/([a-f0-9]{{64}})", path)
    return None


def galgame_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("galgame", PURPOSE, "assets"):
        return False
    target = asset_query_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    project = f"{SOURCE}/{target[1]}"
    return (grant.source_method, grant.source_path) in {
        ("GET", project + "/assets"),
        ("GET", project + "/assets/overview"),
        ("GET", project + "/assets/package-manifest"),
        ("GET", project + "/story/report"),
        ("PATCH", project),
    }
