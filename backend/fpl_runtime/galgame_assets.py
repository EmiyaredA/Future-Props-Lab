"""Digest-bound reads of one Galgame project's file projection."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/galgame-workshop/projects"
PREFIX = "/_internal/v1/galgame-project-assets"
PURPOSE = "galgame.project-assets.read"
MAX_QUERY_BYTES = 2 * 1024 * 1024


class GalgameAssetQuery(LibraryAssetQuery):
    search: str = Field(default="", max_length=255)
    newest_first: bool = False
    replacement: bool = False
    scan: bool = False
    project_file_id: str | None = Field(default=None, pattern="^" + ID + "$")

    @model_validator(mode="after")
    def exact_file_only(self):
        if self.scan and (
            self.replacement or self.project_file_id is not None or self.asset_ids or self.search
        ):
            raise ValueError("元数据扫描只读取当前项目原件")
        if self.replacement and self.project_file_id is None:
            raise ValueError("补链查询必须指定一个文件")
        if self.project_file_id is not None and (self.asset_ids or self.search):
            raise ValueError("单项查询不能读取其他文件")
        return self

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("Galgame 项目标识无效")
        mode = "replacement" if self.replacement else "one"
        suffix = f"/{mode}/{self.project_file_id}" if self.project_file_id else ""
        if self.scan:
            suffix = "/scan"
        return f"{PREFIX}/{project_id}{suffix}/{self.digest}"


class MediaInspection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    width: int | None = Field(ge=0)
    height: int | None = Field(ge=0)
    duration_ms: int | None = Field(ge=0)


class GalgameAssetFile(LibraryAssetDescription):
    display_name: str
    created_at: datetime
    updated_at: datetime
    exists: bool
    inspection: MediaInspection | None = None


def asset_query_target(method, path):
    if method == "POST":
        return re.fullmatch(
            rf"{PREFIX}/({ID})(?:/(?:(?P<mode>one|replacement)/(?P<asset>{ID})|(?P<scan>scan)))?"
            r"/([a-f0-9]{64})",
            path,
        )
    return None


def galgame_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("galgame", PURPOSE, "assets"):
        return False
    target = asset_query_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    project = f"{SOURCE}/{target[1]}"
    asset_id = target["asset"]
    if target["scan"]:
        return (grant.source_method, grant.source_path) == (
            "POST",
            project + "/assets/metadata-scan",
        )
    if target["mode"] == "replacement":
        return grant.source_method == "POST" and grant.source_path in {
            project + "/assets/repair",
            project + "/annotation-imports/preview",
            project + "/annotation-imports",
        }
    if asset_id:
        file = f"{project}/assets/{asset_id}"
        return (grant.source_method, grant.source_path) in {
            ("PATCH", file),
            ("PATCH", file + "/transcript"),
            ("DELETE", file),
        }
    return (grant.source_method, grant.source_path) in {
        ("GET", project + "/assets"),
        ("GET", project + "/assets/overview"),
        ("GET", project + "/assets/package-manifest"),
        ("GET", project + "/story/report"),
        ("GET", project + "/snapshot"),
        ("PATCH", project),
        ("POST", project + "/assets/asr/match-dialogue"),
        ("POST", project + "/assets/asr/transcriptions"),
        ("POST", project + "/annotation-imports"),
        ("POST", project + "/video-exports/preview"),
    }


EXPORT_DOWNLOAD_PURPOSE = "galgame.video-export.download"


def export_download_target(method, path):
    if method == "GET":
        return re.fullmatch(rf"{PREFIX}/({ID})/exports/({ID})/files/({ID})", path)
    return None


def export_download_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "galgame",
        EXPORT_DOWNLOAD_PURPOSE,
        "assets",
        "GET",
    ):
        return False
    target = export_download_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    project_id, export_id, _ = target.groups()
    return grant.source_path == f"{SOURCE}/{project_id}/video-exports/{export_id}/download"
