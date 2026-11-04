"""Digest-bound reads of one Galgame project's file projection."""

import re
from datetime import datetime

from pydantic import Field, model_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/galgame-workshop/projects"
PREFIX = "/_internal/v1/galgame-project-assets"
PURPOSE = "galgame.project-assets.read"
MAX_QUERY_BYTES = 2 * 1024 * 1024


class GalgameAssetQuery(LibraryAssetQuery):
    search: str = Field(default="", max_length=255)
    newest_first: bool = False
    project_file_id: str | None = Field(default=None, pattern="^" + ID + "$")

    @model_validator(mode="after")
    def exact_file_only(self):
        if self.project_file_id is not None and (self.asset_ids or self.search):
            raise ValueError("单项查询不能读取其他文件")
        return self

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("Galgame 项目标识无效")
        suffix = f"/one/{self.project_file_id}" if self.project_file_id else ""
        return f"{PREFIX}/{project_id}{suffix}/{self.digest}"


class GalgameAssetFile(LibraryAssetDescription):
    display_name: str
    created_at: datetime
    updated_at: datetime
    exists: bool


def asset_query_target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{PREFIX}/({ID})(?:/one/(?P<asset>{ID}))?/([a-f0-9]{{64}})", path)
    return None


def galgame_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("galgame", PURPOSE, "assets"):
        return False
    target = asset_query_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    project = f"{SOURCE}/{target[1]}"
    asset_id = target["asset"]
    if asset_id:
        return grant.source_method == "PATCH" and grant.source_path == (
            f"{project}/assets/{asset_id}/transcript"
        )
    return (grant.source_method, grant.source_path) in {
        ("GET", project + "/assets"),
        ("GET", project + "/assets/overview"),
        ("GET", project + "/assets/package-manifest"),
        ("GET", project + "/story/report"),
        ("PATCH", project),
        ("POST", project + "/assets/asr/match-dialogue"),
    }
