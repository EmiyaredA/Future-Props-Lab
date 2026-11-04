"""Fixed library metadata and exact-version reads for Presentation project writes."""

import re

from pydantic import Field

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

PREFIX = "/_internal/v1/presentation-assets"
SOURCE = "/v1/presentation-workshop"
PROJECTS = SOURCE + "/projects"
BUNDLE = SOURCE + "/library/import"
LIBRARY = {kind: f"{SOURCE}/{kind}s" for kind in ("template", "example")}
PURPOSE = "presentation.project-assets.read"
MAX_IDS = 64


class PresentationQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)

    @property
    def path(self):
        return f"{PREFIX}/metadata/{self.digest}"


class PresentationAsset(LibraryAssetDescription):
    @property
    def content_path(self):
        return f"{PREFIX}/content/{self.id}/{self.revision}"


def project_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.target_method) != (
        "presentation",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    method, path = grant.source_method, grant.source_path
    allowed = (
        (method == "POST" and path == PROJECTS)
        or (method == "PUT" and re.fullmatch(rf"{PROJECTS}/{ID}", path))
        or (
            method == "POST"
            and (
                path == BUNDLE
                or path in LIBRARY.values()
                or re.fullmatch(rf"{PROJECTS}/{ID}/(?:operations|template/apply)", path)
                or any(
                    re.fullmatch(rf"{prefix}/{ID}/documents", path) for prefix in LIBRARY.values()
                )
            )
        )
        or (
            method == "PUT"
            and any(re.fullmatch(rf"{prefix}/{ID}", path) for prefix in LIBRARY.values())
        )
    )
    return bool(
        allowed
        and re.fullmatch(
            rf"{PREFIX}/(?:metadata/[0-9a-f]{{64}}|content/{ID}/[0-9]{{1,20}})",
            grant.target_path,
        )
    )
