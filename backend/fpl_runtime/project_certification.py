"""A narrowly signed command for one project owner to apply an official marker."""

import hashlib
import time
from dataclasses import asdict, dataclass
from typing import Literal
from uuid import UUID

import jwt
from pydantic import BaseModel, ConfigDict, Field

from .claims import ISSUER, Actor

PREFIX = "/_internal/v1/project-certification"
AUDIENCE = "fpl-project-certification-v1"
AUDIT_AUDIENCE = "fpl-project-certification-audit-v1"
MAX_BODY = 32 * 1024
PROJECT_EVENT = "project.certification.updated"
Kind = Literal["visual", "galgame"]


class CertificationCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Kind
    project_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    request_id: UUID
    expected_revision: int = Field(ge=0, strict=True)
    is_official: bool = Field(strict=True)

    @property
    def source(self):
        return f"/v1/account/project-certification/{self.kind}/{self.project_id}"

    def fingerprint(self, owner):
        return hashlib.sha256(
            b"fpl-certification-v1\0" + owner.encode() + b"\0" + self.model_dump_json().encode()
        ).hexdigest()


class CertificationAuthorization(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertion: str = Field(min_length=1, max_length=8192)
    command: CertificationCommand


class CertificationProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: str = Field(min_length=1, max_length=8192)


class CertificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    is_official: bool = Field(strict=True)
    revision: int = Field(ge=1, strict=True)

    def matches(self, command):
        return (
            self.id == command.project_id
            and self.is_official is command.is_official
            and self.revision == command.expected_revision + 1
        )


class CertificationAudit(CertificationProof):
    result: CertificationResult


class CertificationAuditReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    request_id: UUID
    audit_event_id: UUID
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class ConfirmedCertification(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    result: CertificationResult
    proof: str = Field(min_length=1, max_length=8192)


class SignedCertificationAudit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    receipt: CertificationAuditReceipt
    proof: str = Field(min_length=1, max_length=8192)


def sign_audit_receipt(receipt, *, private_key, key_id):
    return jwt.encode(
        {"iss": ISSUER, "aud": AUDIT_AUDIENCE, "receipt": receipt.model_dump(mode="json")},
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id, "typ": AUDIT_AUDIENCE},
    )


def verify_audit_receipt(token, command, owner, *, public_key):
    payload = jwt.decode(
        token,
        public_key,
        algorithms=["EdDSA"],
        issuer=ISSUER,
        audience=AUDIT_AUDIENCE,
        options={"require": ["iss", "aud", "receipt"]},
    )
    receipt = CertificationAuditReceipt.model_validate(payload["receipt"])
    if (
        jwt.get_unverified_header(token).get("typ") != AUDIT_AUDIENCE
        or receipt.request_id != command.request_id
        or receipt.fingerprint != command.fingerprint(owner)
    ):
        raise ValueError("作品认证审计回执不匹配")
    return receipt


@dataclass(frozen=True)
class CertificationAuthority:
    actor: Actor
    command: CertificationCommand
    deadline: int

    def __post_init__(self):
        if (
            self.actor.auth_kind != "session"
            or self.actor.purpose != "studio"
            or self.actor.platform_role != "admin"
            or "studio:write" not in self.actor.scopes
        ):
            raise ValueError("作品认证需要当前管理员浏览器会话")


def issue_certification(actor, command, *, private_key, key_id):
    now = int(time.time())
    authority = CertificationAuthority(actor, command, now + 30)
    return jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": actor.user_id,
            "iat": now,
            "nbf": now,
            "exp": authority.deadline,
            "actor": asdict(actor),
            "command": command.model_dump(mode="json"),
        },
        private_key,
        algorithm="EdDSA",
        headers={"kid": key_id, "typ": AUDIENCE},
    )


def verify_certification(token, *, public_key, allow_expired=False):
    payload = jwt.decode(
        token,
        public_key,
        algorithms=["EdDSA"],
        issuer=ISSUER,
        audience=AUDIENCE,
        options={
            "verify_exp": not allow_expired,
            "require": ["iss", "aud", "sub", "iat", "nbf", "exp", "actor", "command"],
        },
    )
    if (
        jwt.get_unverified_header(token).get("typ") != AUDIENCE
        or any(type(payload[name]) is not int for name in ("iat", "nbf", "exp"))
        or payload["iat"] != payload["nbf"]
        or payload["exp"] - payload["iat"] != 30
    ):
        raise jwt.InvalidTokenError("作品认证授权范围无效")
    actor_fields = dict(payload["actor"])
    actor_fields["scopes"] = tuple(actor_fields["scopes"])
    actor = Actor(**actor_fields)
    if payload["sub"] != actor.user_id:
        raise jwt.InvalidTokenError("作品认证授权账号不匹配")
    return CertificationAuthority(
        actor, CertificationCommand.model_validate(payload["command"]), payload["exp"]
    )
