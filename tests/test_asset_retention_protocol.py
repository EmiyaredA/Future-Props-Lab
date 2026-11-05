"""Account-bound retention uses real Identity and only temporary owned storage."""

import os
import subprocess
import sys
from pathlib import Path

from tests.test_asset_reference_retention import assets as assets

ROOT = Path(__file__).resolve().parents[1]


def test_retention_protocol_uses_owned_intents_and_live_identity(tmp_path):
    state = tmp_path / "identity"
    result = subprocess.run(
        [sys.executable, str(ROOT / "tests/retention_protocol_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "IDENTITY_TEST_ROOT": str(state),
            "FPL_DATABASE_PATH": str(state / "service.db"),
            "FPL_CONFIG_FILE": str(state / "absent-config.toml"),
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_retention_authority_is_bound_to_caller_request_and_complete_change():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from studio.contracts.asset_library.references import PrepareReferenceChange
    from studio.contracts.asset_library.retention_authority import issue_retention, verify_retention
    from studio.contracts.identity.claims import Actor

    private = Ed25519PrivateKey.generate()
    actor = Actor(
        "owner", "user", "session", ("studio:private_read", "studio:write"), session_id="session"
    )
    body = PrepareReferenceChange(
        request_id="saved-request",
        resource_kind="note",
        resource_id="one",
        expected_resource_revision=6,
        asset_ids=["image", "audio"],
    )
    token = issue_retention(
        actor, caller="thought", change=body, private_key=private, key_id="test-key", now=100
    )
    # Finalization is deliberately not a new business submission and has no TTL.
    grant = verify_retention(token, public_key=private.public_key())
    assert grant.prepare_before == 130
    assert grant.matches(body)
    for field, value in (
        ("request_id", "another"),
        ("resource_id", "another"),
        ("expected_resource_revision", 7),
        ("asset_ids", ["image"]),
    ):
        assert not grant.matches(body.model_copy(update={field: value}))


def test_other_token_purposes_keys_and_malformed_retention_claims_are_rejected():
    import jwt
    import pytest
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from studio.contracts.asset_library.references import PrepareReferenceChange
    from studio.contracts.asset_library.retention_authority import issue_retention, verify_retention
    from studio.contracts.identity.claims import Actor, issue_context

    private = Ed25519PrivateKey.generate()
    actor = Actor("owner", "user", "session", ("studio:write",), session_id="session")
    ordinary = issue_context(
        actor,
        service="assets",
        method="GET",
        path="/v1/files",
        private_key=private,
        key_id="test-key",
    )
    with pytest.raises(jwt.InvalidTokenError):
        verify_retention(ordinary, public_key=private.public_key())
    body = PrepareReferenceChange(
        request_id="a",
        resource_kind="note",
        resource_id="b",
        expected_resource_revision=0,
        asset_ids=[],
    )
    token = issue_retention(
        actor, caller="thought", change=body, private_key=private, key_id="test"
    )
    with pytest.raises(jwt.InvalidTokenError):
        verify_retention(token, public_key=Ed25519PrivateKey.generate().public_key())
    claims = jwt.decode(
        token, private.public_key(), algorithms=["EdDSA"], audience="fpl-assets-retention-v1"
    )
    for changes in (
        {"sub": "different-owner"},
        {"prepare_before": True},
        {"prepare_before": claims["iat"] + 31},
        {"exp": claims["iat"] + 30},
        {"change_sha256": "invalid"},
        {"caller": "identity"},
    ):
        bad = jwt.encode(
            {**claims, **changes},
            private,
            algorithm="EdDSA",
            headers={"typ": "fpl-asset-retention-v1"},
        )
        with pytest.raises((jwt.InvalidTokenError, ValueError, TypeError)):
            verify_retention(bad, public_key=private.public_key())


async def test_retention_client_never_follows_redirects_or_aborts_unknown_outcomes():
    import httpx
    import pytest

    from studio.apps.asset_library.clients.retention import RetentionClient
    from studio.contracts.asset_library.references import PrepareReferenceChange
    from studio.runtime.http.capability_client import CapabilityUnavailable

    requests = []

    async def respond(request):
        requests.append(request)
        return httpx.Response(307, headers={"Location": "https://unexpected.example.test/"})

    client = RetentionClient(
        service="thought", credential="test-only", transport=httpx.MockTransport(respond)
    )
    try:
        with pytest.raises(CapabilityUnavailable):
            await client.prepare(
                authority="test-bounded-authority",
                change=PrepareReferenceChange(
                    request_id="one",
                    resource_kind="note",
                    resource_id="note",
                    expected_resource_revision=-1,
                    asset_ids=[],
                ),
            )
        assert len(requests) == 1
        assert requests[0].url.host == "assets"
        assert requests[0].url.path == "/_internal/v1/retention/prepare"
        for intent_id in ("../another", "one?owner=another", "one/commit", ""):
            with pytest.raises(ValueError):
                await client.abort(authority="test", intent_id=intent_id)
        assert len(requests) == 1
    finally:
        await client.close()


async def test_expired_preparation_cannot_create_an_intent_even_if_admission_was_delayed(assets):
    import pytest
    from sqlalchemy import select

    from app.capabilities.asset_store.library import AssetError
    from studio.apps.asset_library.references.reference_changes import ReferenceChanges
    from studio.apps.asset_library.storage.service_models import ReferenceIntent
    from studio.contracts.asset_library.references import PrepareReferenceChange

    database, _references = assets
    with pytest.raises(AssetError) as rejected:
        await ReferenceChanges(database).prepare(
            owner="alpha",
            service="thought",
            not_after=1,
            change=PrepareReferenceChange(
                request_id="expired",
                resource_kind="note",
                resource_id="note",
                expected_resource_revision=-1,
                asset_ids=["one"],
            ),
        )
    assert rejected.value.code == "retention_preparation_expired"
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert await session.scalar(select(ReferenceIntent)) is None
