"""Fixed Thought article synchronization RPCs; credentials remain inside Integrations."""

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .integration_intents import digest

ID = r"[A-Za-z0-9_-]{1,100}"
DOC = r"[A-Za-z0-9]{1,200}"


class ExternalAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern="^" + ID + "$")
    filename: str = Field(min_length=1, max_length=500)
    mime: Literal["image/png", "image/jpeg", "image/gif", "image/webp"]
    byte_size: int = Field(ge=1, le=20 * 1024 * 1024)
    content_sha: str = Field(pattern=r"^[a-f0-9]{64}$")


class ExternalTaskPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: dict
    remote: dict
    asset_manifest: list[ExternalAsset] = Field(max_length=1000)

    @model_validator(mode="after")
    def consistent_assets(self):
        ids = [asset.id for asset in self.asset_manifest]
        if len(ids) != len(set(ids)) or set(ids) != set(self.content.get("asset_ids", [])):
            raise ValueError("同步素材清单与文章不一致")
        return self

    def fingerprint(self):
        return digest(self.model_dump(mode="json"))


class ExternalRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal[
        "get",
        "require_enabled",
        "resolve_document",
        "target",
        "binding_target",
        "read",
        "can_write",
    ]
    connection_revision: int | None = Field(default=None, ge=0)
    url: str = Field(default="", max_length=2048)
    document_id: str = Field(default="", pattern=r"^[A-Za-z0-9]{0,200}$")

    @model_validator(mode="after")
    def operation_fields(self):
        if self.op in {"resolve_document", "target", "binding_target"}:
            valid = bool(self.url) and not self.document_id
        elif self.op in {"read", "can_write"}:
            valid = bool(self.document_id) and not self.url
        else:
            valid = not self.url and not self.document_id
        if not valid:
            raise ValueError("同步读取字段不符合固定操作")
        return self

    def fingerprint(self):
        return digest(self.model_dump(mode="json"))

    def path(self, note_id, connection_id):
        if not re.fullmatch(ID, note_id) or not re.fullmatch(ID, connection_id):
            raise ValueError("同步读取缺少固定文章和连接")
        return f"/_internal/v1/external-sync/reads/{note_id}/{connection_id}/{self.fingerprint()}"

    def task_path(self, intent_id):
        return (
            f"/_internal/v1/external-sync/tasks/{UUID(str(intent_id))}/reads/{self.fingerprint()}"
        )


def read_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"/_internal/v1/external-sync/reads/({ID})/({ID})/[a-f0-9]{{64}}", path
    )


class ExternalBindingTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(pattern=r"^[A-Za-z0-9]{1,200}$")
    title: str
    can_write: bool


def read_grant(grant):
    target = read_target(grant.target_method, grant.target_path)
    if (
        not target
        or grant.caller != "thought"
        or grant.target_service != "integrations"
        or grant.purpose != "thought.external-sync.read"
    ):
        return False
    prefix = f"/v1/thought-workshop/notes/{target[1]}/external-sync"
    return (
        grant.source_method == "PUT"
        and grant.source_path == prefix + "/binding"
        or grant.source_method == "POST"
        and (
            grant.source_path in {prefix + "/preview", prefix + "/tasks"}
            or re.fullmatch(re.escape(prefix) + rf"/tasks/{ID}/reconcile", grant.source_path)
        )
    )


class ExternalStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_payload: ExternalTaskPayload
    step_id: UUID
    kind: Literal["append", "upload_image", "replace_image", "delete_prefix"]
    tree: dict = Field(default_factory=dict)
    revision: int = Field(default=0, ge=0)
    block_id: str = Field(default="", pattern=r"^[A-Za-z0-9_-]{0,200}$")
    token: str = Field(default="", max_length=500)
    count: int = Field(default=0, ge=0, le=20000)
    image_base64: str = Field(default="", max_length=28 * 1024 * 1024)

    @model_validator(mode="after")
    def operation_fields(self):
        if self.kind == "append":
            valid = bool(self.tree) and not any(
                (self.block_id, self.token, self.count, self.image_base64)
            )
        elif self.kind == "upload_image":
            valid = bool(self.block_id and self.image_base64) and not any(
                (self.tree, self.token, self.count, self.revision)
            )
        elif self.kind == "replace_image":
            valid = bool(self.block_id and self.token) and not any(
                (self.tree, self.count, self.image_base64)
            )
        else:
            valid = self.count > 0 and not any(
                (self.tree, self.block_id, self.token, self.image_base64)
            )
        if not valid:
            raise ValueError("同步步骤字段不符合固定操作")
        return self

    def fingerprint(self):
        return digest(self.model_dump(mode="json"))

    def path(self, intent_id):
        prefix = f"/_internal/v1/external-sync/tasks/{UUID(str(intent_id))}"
        return prefix + f"/steps/{self.step_id}/{self.fingerprint()}"

    @property
    def action_key(self):
        return self.kind + (
            ":" + self.block_id if self.kind in {"upload_image", "replace_image"} else ""
        )


class ExternalIntentGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["thought"] = "thought"
    intent_id: UUID
    operation: Literal["read", "step"]
    request_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    step_id: UUID | None = None

    @model_validator(mode="after")
    def step_scope(self):
        if (self.step_id is not None) != (self.operation == "step"):
            raise ValueError("同步写入缺少固定步骤")
        return self

    @property
    def path(self):
        prefix = f"/_internal/v1/external-sync/tasks/{self.intent_id}"
        if self.operation == "read":
            return prefix + "/reads/" + self.request_sha256
        return prefix + f"/steps/{self.step_id}/{self.request_sha256}"


class ExternalClose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note_id: str = Field(pattern="^" + ID + "$")
    task_id: UUID
    acknowledge_partial: Literal[True] = True

    def fingerprint(self):
        return digest(self.model_dump(mode="json"))

    def path(self):
        return (
            f"/_internal/v1/external-sync/closed/{self.note_id}/{self.task_id}/{self.fingerprint()}"
        )


def close_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"/_internal/v1/external-sync/closed/({ID})/([a-f0-9-]{{36}})/[a-f0-9]{{64}}", path
    )


def close_grant(grant):
    target = close_target(grant.target_method, grant.target_path)
    return bool(
        target
        and grant.caller == "thought"
        and grant.target_service == "integrations"
        and grant.purpose == "thought.external-sync.close"
        and grant.source_method == "POST"
        and grant.source_path
        == f"/v1/thought-workshop/notes/{target[1]}/external-sync/tasks/{target[2]}/reconcile"
    )
