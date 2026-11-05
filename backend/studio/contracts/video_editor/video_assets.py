"""Read the original kinds of an exact set of account-owned Video project files."""

import re
from datetime import datetime

from pydantic import Field

from studio.contracts.asset_library.descriptions import (
    ID,
    LibraryAssetDescription,
    LibraryAssetQuery,
)

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
    if (grant.caller, grant.purpose, grant.target_service, grant.target_method) != (
        "video",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    if (grant.source_method, grant.source_path) == ("GET", SOURCE + "/import-sources"):
        return grant.target_path == PREFIX + "/sources"
    if grant.source_method == "GET":
        source = re.fullmatch(rf"{SOURCE}/projects/({ID})/(assets|snapshot)", grant.source_path)
        if source:
            return grant.target_path == f"{PREFIX}/{source[1]}/files"
        source = re.fullmatch(
            rf"{SOURCE}/projects/({ID})/(preview/frame|text-clips/[^/]{{1,64}}/layer)",
            grant.source_path,
        )
        return bool(
            source
            and re.fullmatch(rf"{PREFIX}/{source[1]}/metadata/[0-9a-f]{{64}}", grant.target_path)
        )
    patch = re.fullmatch(rf"{SOURCE}/projects/({ID})/assets/({ID})", grant.source_path)
    if grant.source_method == "PATCH" and patch:
        return grant.target_path == f"{PREFIX}/{patch[1]}/files/{patch[2]}/descriptor"
    bake = re.fullmatch(rf"{SOURCE}/projects/({ID})/assets/({ID})/bakes", grant.source_path)
    if grant.source_method == "POST" and bake:
        return grant.target_path == f"{PREFIX}/{bake[1]}/files/{bake[2]}/descriptor"
    retry = re.fullmatch(rf"{SOURCE}/projects/({ID})/assets/({ID})/proxy/retry", grant.source_path)
    if grant.source_method == "POST" and retry:
        return grant.target_path == f"{PREFIX}/{retry[1]}/files/{retry[2]}/descriptor"
    source = re.fullmatch(
        rf"{SOURCE}/projects/({ID})/(timeline/operations|audio-seams/candidates|clip-merges|segment-exports)",
        grant.source_path,
    )
    return bool(
        grant.source_method == "POST"
        and source
        and re.fullmatch(rf"{PREFIX}/{source[1]}/metadata/[0-9a-f]{{64}}", grant.target_path)
    )


class VideoAsset(LibraryAssetDescription):
    display_name: str
    created_at: datetime


WRITE_PURPOSE = "video.project-assets.write"


def video_write_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{PREFIX}/({ID})/writes/([a-f0-9]{{32}})/(upload|copy)/([a-f0-9]{{64}})",
        path,
    )


def video_write_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "video",
        WRITE_PURPOSE,
        "assets",
        "POST",
    ):
        return False
    match = video_write_target(grant.target_method, grant.target_path)
    if not match:
        return False
    suffix = "/assets/import" if match[3] == "copy" else "/assets"
    return grant.source_path == f"{SOURCE}/projects/{match[1]}{suffix}"


class VideoCopyQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=100)
