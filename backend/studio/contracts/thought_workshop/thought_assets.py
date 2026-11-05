"""Fixed private library metadata and version-bound byte transport for Thought."""

import re

from studio.contracts.asset_library.descriptions import ID as ID
from studio.contracts.asset_library.descriptions import LibraryAssetDescription, LibraryAssetQuery

PREFIX = "/_internal/v1/thought-library"


class AssetQuery(LibraryAssetQuery):
    @property
    def path(self):
        return PREFIX + "/metadata/" + self.digest


class AssetDescription(LibraryAssetDescription):
    @property
    def content_path(self):
        return PREFIX + "/content/" + self.id + "/" + str(self.revision)


def asset_grant(grant):
    if not (
        grant.caller == "thought"
        and grant.purpose == "thought.library.read"
        and grant.source_path.startswith("/v1/thought-workshop/")
        and grant.target_service == "assets"
    ):
        return False
    return bool(
        (
            grant.target_method == "POST"
            and re.fullmatch(PREFIX + r"/metadata/[0-9a-f]{64}", grant.target_path)
        )
        or (
            grant.target_method == "GET"
            and re.fullmatch(PREFIX + r"/content/" + ID + r"/[0-9]{1,20}", grant.target_path)
        )
    )


def upload_grant(grant):
    """Authorize only an upload kind matching its original Thought endpoint."""
    if not (
        grant.caller == "thought"
        and grant.purpose == "thought.library.upload"
        and grant.source_method == "POST"
        and grant.target_service == "assets"
        and grant.target_method in {"GET", "POST"}
    ):
        return False
    kind = {
        "/v1/thought-workshop/images": "image",
        "/v1/thought-workshop/attachments": "attachment",
    }.get(grant.source_path)
    return bool(
        kind
        and re.fullmatch(
            PREFIX + r"/uploads/" + kind + r"/" + ID + r"/[0-9a-f]{64}", grant.target_path
        )
    )
