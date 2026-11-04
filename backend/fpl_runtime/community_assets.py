"""Short-lived proof for one community viewer and one currently published file."""

import time
from dataclasses import asdict
from typing import Literal
from uuid import uuid4

import jwt
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .claims import Actor

ISSUER = "fpl-identity"
AUDIENCE = "fpl-thought-community-asset-v1"


class CommunityAssetEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    viewer_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    source_owner_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    publication_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    publication_revision: int = Field(ge=0, strict=True)
    asset_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    note_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,100}$")
    note_revision: int | None = Field(default=None, ge=0, strict=True)
    article_revision: int | None = Field(default=None, ge=0, strict=True)
    cover: bool = Field(strict=True)

    @model_validator(mode="after")
    def coherent(self):
        note_values = (self.note_id, self.note_revision, self.article_revision)
        if (self.cover and any(value is not None for value in note_values)) or (
            not self.cover and any(value is None for value in note_values)
        ):
            raise ValueError("社区素材必须绑定一篇文章或封面")
        return self


class CommunityAssetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_assertion: str = Field(min_length=1, max_length=8192)
    source_method: Literal["GET"]
    source_path: str = Field(min_length=1, max_length=4096)
    evidence: CommunityAssetEvidence
    size: Literal[128, 320, 640, 1280] | None = None

    def matches_source(self):
        prefix = "/v1/thought-workshop/community/publications/" + self.evidence.publication_id
        if self.evidence.cover:
            return self.source_path == prefix + "/cover"
        return self.source_path == prefix + "/assets/" + self.evidence.asset_id + "/content"


def issue_community_asset(actor, body, *, private_key, key_id, now=None):
    if actor.auth_kind != "session" or actor.purpose != "studio":
        raise ValueError("社区素材仅接受浏览器会话")
    if actor.user_id != body.evidence.viewer_id or not body.matches_source():
        raise ValueError("社区素材来源不匹配")
    timestamp = int(time.time()) if now is None else now
    return jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": actor.user_id,
            "jti": uuid4().hex,
            "iat": timestamp,
            "nbf": timestamp,
            "exp": timestamp + 5,
            "actor": asdict(actor),
            "source_assertion": body.source_assertion,
            "source_method": body.source_method,
            "source_path": body.source_path,
            "evidence": body.evidence.model_dump(mode="json"),
            **({"size": body.size} if body.size is not None else {}),
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id, "typ": AUDIENCE},
    )


def verify_community_asset(token, *, public_key):
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
                "exp",
                "actor",
                "source_assertion",
                "source_method",
                "source_path",
                "evidence",
            ]
        },
    )
    if jwt.get_unverified_header(token).get("typ") != AUDIENCE:
        raise jwt.InvalidTokenError("社区素材授权类型无效")
    if (
        type(payload["iat"]) is not int
        or type(payload["nbf"]) is not int
        or type(payload["exp"]) is not int
        or payload["nbf"] != payload["iat"]
        or payload["exp"] - payload["iat"] != 5
    ):
        raise jwt.InvalidTokenError("社区素材授权时限无效")
    fields = dict(payload["actor"])
    fields["scopes"] = tuple(fields["scopes"])
    actor = Actor(**fields)
    body = CommunityAssetRequest.model_validate(
        {
            **{
                key: payload[key]
                for key in ("source_assertion", "source_method", "source_path", "evidence")
            },
            "size": payload.get("size"),
        }
    )
    if (
        actor.user_id != payload["sub"]
        or actor.user_id != body.evidence.viewer_id
        or actor.auth_kind != "session"
        or actor.purpose != "studio"
        or not body.matches_source()
    ):
        raise jwt.InvalidTokenError("社区素材授权上下文不匹配")
    return actor, body
