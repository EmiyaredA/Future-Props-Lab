"""File manifests for Thought archive staging, with no paths or account override."""

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .asset_references import ReferenceUpdate

BatchId = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
Fingerprint = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ArchiveBatchKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    batch_id: BatchId
    source_sha256: Fingerprint


class ArchiveFileKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ordinal: int = Field(ge=0, lt=10_000, strict=True)
    descriptor_sha256: Fingerprint


class ArchiveProjection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    resource_kind: Literal["knowledge-base", "note", "template"]
    resource_id: str = Field(pattern=r"^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
    resource_revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10_000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)


class ArchiveManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    files: list[ArchiveFileKey] = Field(max_length=10_000)
    projections: list[ArchiveProjection] = Field(max_length=30_000)

    @model_validator(mode="after")
    def canonical_manifest(self):
        if [file.ordinal for file in self.files] != list(range(len(self.files))):
            raise ValueError("归档文件序号必须连续")
        keys = [(ref.resource_kind, ref.resource_id) for ref in self.projections]
        if keys != sorted(set(keys)):
            raise ValueError("归档资源必须按类型与标识排序且不得重复")
        return self

    @property
    def fingerprint(self):
        return hashlib.sha256(
            json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


IMPORT_PATH = "/v1/thought-workshop/imports"
PREFIX = "/_internal/v1/thought-archives"
PURPOSE = "thought.archive.stage"
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
SETTLE_PATH = PREFIX + "/settle"


def archive_target(method, path):
    import re

    return method == "POST" and re.fullmatch(
        PREFIX + r"/([a-f0-9]{32})/([a-f0-9]{64})/(files/[0-9]{1,4}|seal)/([a-f0-9]{64})",
        path,
    )


def archive_grant(grant):
    return bool(
        grant.caller == "thought"
        and grant.purpose == PURPOSE
        and (grant.source_method, grant.source_path) == ("POST", IMPORT_PATH)
        and grant.target_service == "assets"
        and archive_target(grant.target_method, grant.target_path)
    )


class ArchiveOutcome(ArchiveBatchKey):
    owner: str = Field(pattern=r"^[A-Za-z0-9_-]{1,36}$")
    decision: Literal["commit", "abort"]
    manifest_sha256: Fingerprint | None = None

    @model_validator(mode="after")
    def coherent(self):
        if (self.decision == "commit") != (self.manifest_sha256 is not None):
            raise ValueError("归档提交必须绑定封存摘要")
        return self


class ArchiveAuthenticator:
    """Separate domains for receipts and decisions using the Thought–Assets peer key."""

    def __init__(self, secret):
        if not isinstance(secret, str) or not secret.isascii() or len(secret) < 32:
            raise ValueError("归档对等凭据无效")
        self.secret = secret.encode("ascii")

    def sign(self, use, *, path, owner, nonce, body):
        import hmac
        import re

        if use not in {"receipt", "decision", "community-stage"} or not re.fullmatch(
            r"[a-f0-9]{32}", nonce
        ):
            raise ValueError("归档签名绑定无效")
        payload = json.dumps(
            [use, path, owner, nonce, hashlib.sha256(body).hexdigest()],
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("ascii")
        return hmac.new(
            self.secret, b"fpl-thought-archive-v1\0" + payload, hashlib.sha256
        ).hexdigest()

    def verify(self, signature, use, **binding):
        import hmac

        if (
            not isinstance(signature, str)
            or len(signature) != 64
            or not signature.isascii()
            or not hmac.compare_digest(signature, self.sign(use, **binding))
        ):
            raise ValueError("归档回执或源决议签名无效")
