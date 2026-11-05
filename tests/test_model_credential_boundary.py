"""Call attribution must survive service isolation without loading the account database."""

import os
import subprocess
import sys
from dataclasses import FrozenInstanceError
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.llm.call_logs.record_attribution import snapshot_from_row
from studio.contracts.identity.claims import Actor, issue_context, verify_context
from studio.contracts.model_service.credential_snapshot import (
    snapshot_from_actor,
)


def test_snapshot_and_log_query_imports_do_not_initialize_identity_or_monolith_storage():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "from studio.contracts.model_service.credential_snapshot "
                "import CredentialSnapshot; "
                "import app.llm.call_logs.query; "
                "import app.llm.catalog.service; import app.llm.catalog.defaults; "
                "assert 'app.console.models.accounts' not in sys.modules; "
                "assert 'studio.runtime.database.website' not in sys.modules; "
                "assert 'studio.assembly.http_dependencies' not in sys.modules"
            ),
        ],
        env={**os.environ, "PYTHONPATH": "backend"},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_verified_api_key_metadata_is_an_immutable_historical_snapshot():
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "owner",
        "user",
        "management_api_key",
        ("studio:private_read",),
        api_key_id="key-id",
        api_key_name="模型脚本",
        api_key_prefix="fpm_public",
    )
    token = issue_context(
        actor,
        service="models",
        method="GET",
        path="/v1/model-providers",
        private_key=key,
        key_id="test",
    )
    verified = verify_context(
        token,
        service="models",
        method="GET",
        path="/v1/model-providers",
        public_key=key.public_key(),
    )
    snap = snapshot_from_actor(verified)
    assert snap.api_key_name == "模型脚本" and snap.api_key_prefix == "fpm_public"
    row = SimpleNamespace(**snap.as_kwargs())
    assert snapshot_from_row(row) == snap
    with pytest.raises(FrozenInstanceError):
        snap.api_key_name = "renamed later"


@pytest.mark.parametrize(
    "changes",
    [
        {"api_key_name": "x" * 65},
        {"api_key_prefix": "x" * 17},
        {"api_key_name": 1},
    ],
)
def test_unbounded_or_malformed_metadata_is_rejected(changes):
    with pytest.raises(ValueError):
        Actor("owner", "user", "management_api_key", (), api_key_id="key", **changes)


def test_session_attribution_cannot_contain_api_key_metadata():
    actor = Actor("owner", "user", "session", (), session_id="session")
    assert snapshot_from_actor(actor).as_kwargs() == {
        "auth_kind": "session",
        "api_key_id": None,
        "api_key_name": None,
        "api_key_prefix": None,
    }
    with pytest.raises(ValueError):
        Actor("owner", "user", "session", (), session_id="session", api_key_name="forged")
