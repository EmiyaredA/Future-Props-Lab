"""Short-lived Identity evidence binding one Creative install to its raw body."""

import hashlib
import re
import time
from dataclasses import dataclass

import jwt

from studio.contracts.creative_workshop.creative_source_evidence import MAX_BODY, strict_json

INSTALL_PATH = "/v1/creative-workshop/installations"
AUDIENCE = "creative-install-evidence"
PURPOSE = "creative.install.request"


def install_fields(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BODY:
        raise ValueError("invalid body size")
    body = strict_json(raw)
    if (
        not isinstance(body, dict)
        or not {"release_id"} <= body.keys()
        or body.keys() - {"release_id", "names"}
    ):
        raise ValueError("invalid install body")
    release_id, names = body["release_id"], body.get("names", {})
    identity = r"[A-Za-z0-9_-]{1,100}"
    if (
        not isinstance(release_id, str)
        or not re.fullmatch(identity, release_id)
        or not isinstance(names, dict)
        or len(names) > 50
        or any(
            not isinstance(key, str)
            or not re.fullmatch(identity, key)
            or not isinstance(value, str)
            or len(value) > 120
            for key, value in names.items()
        )
    ):
        raise ValueError("invalid install fields")
    return release_id


@dataclass(frozen=True)
class InstallEvidence:
    owner_user_id: str
    request_id: str
    body_sha256: str
    release_id: str
    expires_at: int


def issue_install_evidence(*, actor, request_id, raw, source_expiry, private_key, key_id):
    release_id = install_fields(raw)
    now = int(time.time())
    expiry = min(now + 10, source_expiry)
    if expiry <= now or not actor.user_id or not isinstance(request_id, str) or not request_id:
        raise ValueError("invalid source assertion")
    return jwt.encode(
        {
            "iss": "fpl-identity",
            "aud": AUDIENCE,
            "sub": actor.user_id,
            "iat": now,
            "nbf": now,
            "exp": expiry,
            "purpose": PURPOSE,
            "request_id": request_id,
            "body_sha256": hashlib.sha256(raw).hexdigest(),
            "release_id": release_id,
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id},
    )


def verify_install_evidence(
    token, *, public_key, owner_user_id, request_id, body_sha256, release_id
):
    claims = jwt.decode(
        token,
        public_key,
        algorithms=["EdDSA"],
        issuer="fpl-identity",
        audience=AUDIENCE,
        options={
            "require": [
                "sub",
                "iat",
                "nbf",
                "exp",
                "purpose",
                "request_id",
                "body_sha256",
                "release_id",
            ]
        },
    )
    if (
        claims["purpose"] != PURPOSE
        or claims["sub"] != owner_user_id
        or claims["request_id"] != request_id
        or claims["body_sha256"] != body_sha256
        or claims["release_id"] != release_id
        or type(claims["iat"]) is not int
        or type(claims["exp"]) is not int
        or not 0 < claims["exp"] - claims["iat"] <= 10
    ):
        raise jwt.InvalidTokenError("creative install evidence mismatch")
    return InstallEvidence(owner_user_id, request_id, body_sha256, release_id, claims["exp"])
