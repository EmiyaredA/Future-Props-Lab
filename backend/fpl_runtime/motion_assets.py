"""Revision-independent identity and digest checks for owned Motion project files."""

import re

from pydantic import Field

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

SOURCE = "/v1/motion-compositor"
PREFIX = "/_internal/v1/motion-project-assets"
PURPOSE = "motion.project-assets.read"
MAX_IDS = 64
MOTION_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".mkv"})


class MotionAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)

    def path(self, project_id):
        if not re.fullmatch(ID, project_id):
            raise ValueError("特效项目标识无效")
        return f"{PREFIX}/{project_id}/metadata/{self.digest}"


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
    method, source, target = grant.source_method, grant.source_path, grant.target_path
    if (method, source, target) == ("GET", SOURCE + "/import-sources", PREFIX + "/sources"):
        return True
    match = re.fullmatch(rf"{SOURCE}/projects/({ID})(/.*)", source)
    if match is None:
        return False
    project, suffix = match.groups()
    if (method, suffix) in {
        ("POST", "/document/operations"),
        ("GET", "/preview/frame"),
        ("POST", "/exports"),
    }:
        return bool(re.fullmatch(rf"{PREFIX}/{project}/metadata/[0-9a-f]{{64}}", target))
    if (method, suffix) == ("GET", "/snapshot"):
        return target == f"{PREFIX}/{project}/snapshot-metadata"
    if (method, suffix) == ("GET", "/assets"):
        return target == f"{PREFIX}/{project}/files"
    file = re.fullmatch(rf"/assets/({ID})/file", suffix)
    return bool(method == "GET" and file and target == f"{PREFIX}/{project}/files/{file[1]}")


class MotionCopyQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=100)


WRITE_PURPOSE = "motion.project-assets.write"


def motion_asset_write_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{PREFIX}/({ID})/writes/([a-f0-9]{{32}})/(upload|copy)/([a-f0-9]{{64}})",
        path,
    )


def motion_asset_write_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "motion",
        WRITE_PURPOSE,
        "assets",
        "POST",
    ):
        return False
    target = motion_asset_write_target(grant.target_method, grant.target_path)
    if not target:
        return False
    project, _, action, _ = target.groups()
    suffix = "/assets" if action == "upload" else "/assets/import"
    return grant.source_path == f"{SOURCE}/projects/{project}{suffix}"
