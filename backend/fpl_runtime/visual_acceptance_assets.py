"""Digest-bound metadata reads for one Visual project's acceptance context."""

import re

from pydantic import BaseModel, ConfigDict, Field

from .library_assets import ID, LibraryAssetQuery
from .visual_assistant import SOURCE
from .visual_catalog import acceptance_scheme_source

PREFIX = "/_internal/v1/visual-acceptance/assets"
PURPOSE = "visual.acceptance-assets.read"


class AcceptanceAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(max_length=41)

    def path(self, project_id):
        target = f"{PREFIX}/{project_id}/{self.digest}"
        if acceptance_asset_target("POST", target) is None:
            raise ValueError("验收素材查询范围无效")
        return target


class AcceptanceAsset(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    display_name: str
    original_filename: str
    media_kind: str
    readable: bool


def acceptance_asset_target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{PREFIX}/({ID})/([a-f0-9]{{64}})", path)
    return None


def acceptance_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("visual", PURPOSE, "assets"):
        return False
    target = acceptance_asset_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    source = f"{SOURCE}/{target[1]}"
    if (grant.source_method, grant.source_path) == ("GET", source + "/acceptance/summary"):
        return True
    return grant.source_path.startswith(source + "/nodes/") and acceptance_scheme_source(
        grant.source_method, grant.source_path
    )
