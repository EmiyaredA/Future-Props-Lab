"""A source request can authorize exactly one asset-retention mutation.

Preparation requires current Identity approval. Finalization only settles the
already accepted mutation, so it remains possible after a browser session ends.
This authority cannot read files, run models or submit any other business job.
"""

import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass
from typing import Literal
from uuid import uuid4

import jwt
from pydantic import BaseModel, ConfigDict, Field

from .asset_references import RESOURCE_KINDS, PrepareReferenceChange
from .claims import Actor

ISSUER = "fpl-identity"
AUDIENCE = "fpl-assets-retention-v1"


def change_digest(change, community=None):
    payload = change.model_dump(mode="json", exclude_none=True)
    if community is not None:
        payload["community"] = community.model_dump(mode="json", exclude_none=True)
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class CommunityRetentionScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    actor_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,36}$")
    owner_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,36}$")
    publication_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    note_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    article_publication_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,128}$")
    publication_revision: int = Field(ge=0, strict=True)
    article_revision: int = Field(ge=0, strict=True)
    note_revision: int = Field(ge=0, strict=True)

    def matches_source(self, method, path):
        base = (
            "/v1/thought-workshop/community/publications/"
            f"{self.publication_id}/notes/{self.note_id}"
        )
        if method == "PUT":
            return path == base and self.article_publication_id in {None, self.publication_id}
        return method == "POST" and path == base + "/multitable/operations"

    def matches_change(self, change):
        return (
            change.resource_kind == "note"
            and change.resource_id == self.note_id
            and change.expected_resource_revision == self.note_revision
            and change.metadata_asset_ids is not None
            and set(change.metadata_asset_ids).issubset(change.asset_ids)
        )


def story_metadata(caller, change):
    return (
        caller == "galgame"
        and change.resource_kind == "story"
        and change.metadata_asset_ids is not None
        and set(change.metadata_asset_ids).issubset(change.asset_ids)
    )


class RetentionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    source_method: Literal["POST", "PUT", "PATCH", "DELETE"]
    source_path: str = Field(min_length=1, max_length=4096)
    assertion: str = Field(min_length=1, max_length=8192)
    change: PrepareReferenceChange
    community: CommunityRetentionScope | None = None


@dataclass(frozen=True)
class RetentionAuthority:
    actor: Actor
    caller: str
    request_id: str
    change_sha256: str
    prepare_before: int
    community: CommunityRetentionScope | None = None

    def __post_init__(self):
        if self.caller not in RESOURCE_KINDS:
            raise ValueError("引用调用方未登记")
        if not isinstance(self.request_id, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,128}", self.request_id
        ):
            raise ValueError("引用请求 ID 无效")
        if not isinstance(self.change_sha256, str) or not re.fullmatch(
            r"[a-f0-9]{64}", self.change_sha256
        ):
            raise ValueError("引用请求摘要无效")
        if type(self.prepare_before) is not int:
            raise ValueError("引用准备期限无效")
        if self.community is not None and (
            self.caller != "thought"
            or self.actor.auth_kind != "session"
            or self.actor.user_id != self.community.actor_id
        ):
            raise ValueError("社区引用授权与编辑者不匹配")

    @property
    def owner_id(self):
        return self.community.owner_id if self.community else self.actor.user_id

    def matches(self, change):
        change.validate_service(self.caller)
        return (
            self.request_id == change.request_id
            and self.change_sha256 == change_digest(change, self.community)
            and (
                self.community.matches_change(change)
                if self.community is not None
                else change.metadata_asset_ids is None or story_metadata(self.caller, change)
            )
        )


def issue_retention(actor, *, caller, change, private_key, key_id, now=None, community=None):
    change.validate_service(caller)
    timestamp = int(time.time()) if now is None else now
    return jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": actor.user_id,
            "jti": uuid4().hex,
            "iat": timestamp,
            "nbf": timestamp,
            "prepare_before": timestamp + 30,
            "caller": caller,
            "request_id": change.request_id,
            "change_sha256": change_digest(change, community),
            "actor": asdict(actor),
            **(
                {"community": community.model_dump(mode="json", exclude_none=True)}
                if community
                else {}
            ),
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id, "typ": "fpl-asset-retention-v1"},
    )


def verify_retention(token, *, public_key):
    payload = jwt.decode(
        token,
        public_key,
        algorithms=["EdDSA"],
        issuer=ISSUER,
        audience=AUDIENCE,
        options={
            "require": [
                "iss",
                "aud",
                "sub",
                "jti",
                "iat",
                "nbf",
                "prepare_before",
                "caller",
                "request_id",
                "change_sha256",
                "actor",
            ],
        },
        leeway=2,
    )
    if jwt.get_unverified_header(token).get("typ") != "fpl-asset-retention-v1":
        raise jwt.InvalidTokenError("引用授权类型无效")
    if (
        type(payload["iat"]) is not int
        or type(payload["nbf"]) is not int
        or payload["iat"] != payload["nbf"]
        or type(payload["prepare_before"]) is not int
        or payload["prepare_before"] - payload["iat"] != 30
        or "exp" in payload
    ):
        raise jwt.InvalidTokenError("引用准备期限无效")
    actor_fields = dict(payload["actor"])
    actor_fields["scopes"] = tuple(actor_fields["scopes"])
    actor = Actor(**actor_fields)
    if actor.user_id != payload["sub"]:
        raise jwt.InvalidTokenError("引用授权账号不匹配")
    return RetentionAuthority(
        actor,
        payload["caller"],
        payload["request_id"],
        payload["change_sha256"],
        payload["prepare_before"],
        CommunityRetentionScope.model_validate(payload["community"])
        if "community" in payload
        else None,
    )
