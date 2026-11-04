"""Narrow grants for the Visual assistant's Models and Assets projections."""

import re

from pydantic import BaseModel, ConfigDict

from .library_assets import ID, LibraryAssetQuery

MAX_QUERY_BYTES = 2 * 1024 * 1024

SOURCE = "/v1/visual-workshop/projects"
MODEL_TARGET = "/_internal/v1/visual-catalog/assistant"
ASSET_PREFIX = "/_internal/v1/visual-conversation-assets"
MODEL_PURPOSE = "visual.assistant-models.read"
ASSET_PURPOSE = "visual.assistant-attachments.read"


def conversation_source(path):
    return re.fullmatch(rf"{SOURCE}/({ID})/conversations(?:/({ID}))?", path)


def attachment_target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{ASSET_PREFIX}/({ID})/({ID})/([0-9a-f]{{64}})", path)
    return None


class AttachmentQuery(LibraryAssetQuery):
    def path(self, project_id, conversation_id):
        path = f"{ASSET_PREFIX}/{project_id}/{conversation_id}/{self.digest}"
        if attachment_target("POST", path) is None:
            raise ValueError("对话素材查询范围无效")
        return path


def assistant_grant(grant):
    if grant.caller != "visual":
        return False
    source = conversation_source(grant.source_path)
    if source is None:
        return False
    if (grant.purpose, grant.target_service, grant.target_method, grant.target_path) == (
        MODEL_PURPOSE,
        "models",
        "GET",
        MODEL_TARGET,
    ):
        methods = {"GET", "PATCH", "DELETE"} if source[2] else {"GET", "POST"}
        return grant.source_method in methods
    if (grant.purpose, grant.target_service) != (ASSET_PURPOSE, "assets"):
        return False
    target = attachment_target(grant.target_method, grant.target_path)
    return bool(
        target
        and grant.source_method in {"GET", "PATCH", "DELETE"}
        and target.groups()[:2] == source.groups()
    )


def conversation_retention(body):
    source = conversation_source(body.source_path)
    change = body.change
    if source is None or change.asset_ids or change.visual_conversation_project != source[1]:
        return False
    if body.source_method == "POST":
        return source[2] is None and change.expected_resource_revision == -1
    return (
        body.source_method == "DELETE"
        and source[2] == change.resource_id
        and change.expected_resource_revision >= 0
    )


class AttachmentMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    id: str
    display_name: str
    mime_type: str
    byte_size: int
