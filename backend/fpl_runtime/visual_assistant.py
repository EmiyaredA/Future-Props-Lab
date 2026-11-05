"""Narrow grants for the Visual assistant's Models and Assets projections."""

import re

from pydantic import BaseModel, ConfigDict, Field

from .library_assets import ID, LibraryAssetQuery
from .motion_preview import DIGEST

MAX_QUERY_BYTES = 2 * 1024 * 1024

SOURCE = "/v1/visual-workshop/projects"
MODEL_TARGET = "/_internal/v1/visual-catalog/assistant"
ASSET_PREFIX = "/_internal/v1/visual-conversation-assets"
INPUT_PREFIX = "/_internal/v1/visual-conversation-inputs"
INPUT_PURPOSE = "visual.assistant-attachment-input.read"
MODEL_RUNS = "/_internal/v1/visual-assistant/model-runs"
MODEL_RUN_PURPOSE = "visual.assistant-model.execute"
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
    message = message_source(grant.source_method, grant.source_path)
    if message:
        if (grant.purpose, grant.target_service, grant.target_method, grant.target_path) == (
            MODEL_PURPOSE,
            "models",
            "GET",
            MODEL_TARGET,
        ):
            return True
        if (grant.purpose, grant.target_service) == (INPUT_PURPOSE, "assets"):
            target = input_target(grant.target_method, grant.target_path)
        elif (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
            target = attachment_target(grant.target_method, grant.target_path)
        else:
            return False
        return bool(target and target.groups()[:2] == message.groups())
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
    change = body.change
    message = message_source(body.source_method, body.source_path)
    if message:
        return (
            change.visual_conversation_project == message[1]
            and change.resource_id == message[2]
            and change.expected_resource_revision >= 0
            and bool(change.asset_ids)
        )
    source = conversation_source(body.source_path)
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


def message_source(method, path):
    return method == "POST" and re.fullmatch(
        rf"{SOURCE}/({ID})/conversations/({ID})/messages/stream", path
    )


def model_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{MODEL_RUNS}/({ID})/({ID})/({ID})/(begin|round/[0-5]|settle)/({DIGEST})", path
    )


def model_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != (
        "visual",
        MODEL_RUN_PURPOSE,
        "models",
    ):
        return False
    source = message_source(grant.source_method, grant.source_path)
    target = model_target(grant.target_method, grant.target_path)
    return bool(source and target and source.groups() == target.groups()[:2])


class AttachmentInputQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=5)

    def path(self, project_id, conversation_id):
        return f"{INPUT_PREFIX}/{project_id}/{conversation_id}/{self.digest}"


class AttachmentImage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    mime_type: str
    data_base64: str
    byte_size: int = Field(ge=1)


class AttachmentContext(AttachmentMetadata):
    original_filename: str
    media_kind: str


class AttachmentInput(AttachmentContext):
    image: AttachmentImage | None = None
    text: str = ""
    warning: str | None = None


class CanvasAssetContextQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=64)

    def path(self, project_id, conversation_id):
        return f"{INPUT_PREFIX}/{project_id}/{conversation_id}/context/{self.digest}"


def input_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{INPUT_PREFIX}/({ID})/({ID})/(?:context/)?({DIGEST})", path
    )
