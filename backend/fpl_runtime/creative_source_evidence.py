"""Short-lived Identity evidence for one exact Creative source import request."""

import hashlib
import json
import re
import time
from dataclasses import dataclass

import jwt

from .claims import verify_context

SOURCE_PATH = "/v1/creative-workshop/items/from-integration"
SOURCE_TRANSFER = "/_internal/v1/creative-sources/"
PURPOSE = "creative.integration-source.read"
AUDIENCE = "creative-source-evidence"
MAX_BODY = 16 * 1024


def source_transfer_target(method, path):
    return method == "POST" and re.fullmatch(
        SOURCE_TRANSFER + r"(tool_api|mcp|skill)/[A-Za-z0-9_-]{1,100}/[a-f0-9]{64}", path
    )


def source_transfer_grant(grant):
    return (
        grant.caller == "creative"
        and grant.purpose == PURPOSE
        and grant.source_method == "POST"
        and grant.source_path == SOURCE_PATH
        and grant.target_service == "integrations"
        and source_transfer_target(grant.target_method, grant.target_path)
    )


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def strict_json(data):
    return json.loads(
        data.decode("utf-8"),
        object_pairs_hook=_object,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("invalid number")),
    )


def source_fields(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BODY:
        raise ValueError("invalid body size")
    data = strict_json(raw)
    if not isinstance(data, dict) or set(data) != {"kind", "source_id"}:
        raise ValueError("invalid source body")
    kind, source_id = data["kind"], data["source_id"]
    if (
        kind not in ("tool_api", "mcp", "skill")
        or not isinstance(source_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", source_id)
    ):
        raise ValueError("invalid source fields")
    return kind, source_id


def verify_source_request(assertion, evidence, raw, *, public_key):
    kind, source_id = source_fields(raw)
    actor = verify_context(
        assertion, service="creative", method="POST", path=SOURCE_PATH, public_key=public_key
    )
    original = jwt.decode(
        assertion,
        public_key,
        algorithms=["EdDSA"],
        issuer="fpl-identity",
        audience="creative",
        options={"require": ["jti"]},
    )
    proof = verify_source_evidence(
        evidence,
        public_key=public_key,
        owner_user_id=actor.user_id,
        request_id=original["jti"],
        body_sha256=hashlib.sha256(raw).hexdigest(),
        kind=kind,
        source_id=source_id,
    )
    return actor, proof


@dataclass(frozen=True)
class SourceEvidence:
    owner_user_id: str
    request_id: str
    body_sha256: str
    kind: str
    source_id: str
    expires_at: int


def issue_source_evidence(*, actor, request_id, raw, source_expiry, private_key, key_id):
    kind, source_id = source_fields(raw)
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
            "kind": kind,
            "source_id": source_id,
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id},
    )


def verify_source_evidence(
    token, *, public_key, owner_user_id, request_id, body_sha256, kind, source_id
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
                "kind",
                "source_id",
            ]
        },
    )
    if (
        claims["purpose"] != PURPOSE
        or claims["sub"] != owner_user_id
        or claims["request_id"] != request_id
        or claims["body_sha256"] != body_sha256
        or claims["kind"] != kind
        or claims["source_id"] != source_id
        or type(claims["iat"]) is not int
        or type(claims["exp"]) is not int
        or not 0 < claims["exp"] - claims["iat"] <= 10
    ):
        raise jwt.InvalidTokenError("creative source evidence mismatch")
    return SourceEvidence(owner_user_id, request_id, body_sha256, kind, source_id, claims["exp"])
