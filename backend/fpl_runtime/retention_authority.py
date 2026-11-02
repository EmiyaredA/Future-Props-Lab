"""A source request can authorize exactly one asset-retention mutation.

Preparation requires current Identity approval. Finalization only settles the
already accepted mutation, so it remains possible after a browser session ends.
This authority cannot read files, run models or submit any other business job.
"""

import hashlib
import json
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


def change_digest(change):
    return hashlib.sha256(
        json.dumps(change.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class RetentionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    source_method: Literal["POST", "PUT", "PATCH", "DELETE"]
    source_path: str = Field(min_length=1, max_length=4096)
    assertion: str = Field(min_length=1, max_length=8192)
    change: PrepareReferenceChange


@dataclass(frozen=True)
class RetentionAuthority:
    actor: Actor
    caller: str
    request_id: str
    change_sha256: str
    prepare_before: int

    def __post_init__(self):
        import re

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

    def matches(self, change):
        change.validate_service(self.caller)
        return self.request_id == change.request_id and self.change_sha256 == change_digest(change)


def issue_retention(actor, *, caller, change, private_key, key_id, now=None):
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
            "change_sha256": change_digest(change),
            "actor": asdict(actor),
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
    )
