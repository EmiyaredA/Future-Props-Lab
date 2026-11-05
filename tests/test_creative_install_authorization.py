"""Creative rechecks original install bytes, signed evidence and live account status."""

import time
from dataclasses import replace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
from fpl_creative.install_authorization import (
    IdentityInstallAuthorization,
    InstallAuthorizationDenied,
    InstallSource,
)
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.creative_install_evidence import INSTALL_PATH, issue_install_evidence


class Live:
    def __init__(self):
        self.active = True
        self.calls = []

    async def status(self, **options):
        self.calls.append(options)
        return self.active


async def test_install_authorization_binds_original_actor_body_release_and_session():
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "owner", "user", "session", ("studio:write", "studio:private_read"), session_id="session"
    )
    assertion = issue_context(
        actor, service="creative", method="POST", path=INSTALL_PATH, private_key=key, key_id="test"
    )
    claims = jwt.decode(
        assertion,
        key.public_key(),
        algorithms=["EdDSA"],
        issuer="fpl-identity",
        audience="creative",
    )
    raw = b'{"release_id":"release","names":{"release":"Local"}}'
    evidence = issue_install_evidence(
        actor=actor,
        request_id=claims["jti"],
        raw=raw,
        source_expiry=claims["exp"],
        private_key=key,
        key_id="test",
    )
    source = InstallSource(assertion, evidence, raw)
    body = CreativeInstallPreviewIn.model_validate_json(raw)
    live = Live()
    authority = IdentityInstallAuthorization(public_key=key.public_key(), identity=live)
    assert await authority.require(source, body) == "owner"
    assert live.calls[0] == {"assertion": assertion, "method": "POST", "path": INSTALL_PATH}
    for invalid in (
        replace(source, raw_body=b'{"release_id":"other"}'),
        replace(source, evidence=evidence + "x"),
        replace(source, assertion=assertion + "x"),
    ):
        with pytest.raises(InstallAuthorizationDenied):
            await authority.require(invalid, body)
    with pytest.raises(InstallAuthorizationDenied):
        await authority.require(source, body.model_copy(update={"names": {"release": "Other"}}))
    assert len(live.calls) == 1
    for state in (False, None):
        live.active = state
        with pytest.raises(InstallAuthorizationDenied):
            await authority.require(source, body)


def test_install_evidence_rejects_expired_source():
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "owner", "user", "session", ("studio:write", "studio:private_read"), session_id="session"
    )
    with pytest.raises(ValueError):
        issue_install_evidence(
            actor=actor,
            request_id="one",
            raw=b'{"release_id":"release"}',
            source_expiry=int(time.time()) - 1,
            private_key=key,
            key_id="test",
        )
