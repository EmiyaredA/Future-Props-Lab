"""Account directory boundaries preserve ownership and avoid networking under a writer lock."""

import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from studio.apps.thought_workshop.account_directory import HttpAccountDirectory
from studio.apps.thought_workshop.errors import ThoughtError
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.account_directory import (
    AccountProfile,
    CallerProfile,
    DirectoryQuery,
)
from studio.contracts.identity.delegation import RequestGrant, permitted, target_permission_path
from studio.contracts.identity.principal import StudioPrincipal

ROOT = Path(__file__).resolve().parents[1]


def test_real_identity_directory_and_isolated_thought_community(tmp_path):
    result = subprocess.run(
        [sys.executable, str(ROOT / "tests/thought_directory_scenario.py")],
        cwd=ROOT,
        env={
            **os.environ,
            "THOUGHT_DIRECTORY_ROOT": str(tmp_path),
            "FPL_DATABASE_PATH": str(tmp_path / "identity/service.db"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "PYTHONPATH": str(ROOT / "backend"),
        },
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_directory_grants_are_bound_to_owned_source_and_exact_digest():
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    query = DirectoryQuery(ids=["alpha"])
    values = dict(
        caller="thought",
        purpose="thought.accounts.read",
        source_method="GET",
        source_path="/v1/thought-workshop/notes",
        target_service="identity",
        target_method="POST",
        target_path=query.path,
    )
    assert permitted(RequestGrant(**values), catalog)
    assert target_permission_path(RequestGrant(**values)) == "/v1/thought-workshop/notes"
    for patch in (
        {"caller": "models"},
        {"source_path": "/v1/model-inference/options"},
        {"target_method": "GET"},
        {"target_service": "models"},
        {"target_path": "/_internal/v1/thought-account-directory/not-a-digest"},
    ):
        assert not permitted(RequestGrant(**{**values, **patch}), catalog)
    assert query.digest != DirectoryQuery(ids=["beta"]).digest


async def test_actor_snapshot_expires_without_silent_refresh():
    principal = StudioPrincipal(
        user_id="alpha",
        platform_role="user",
        auth_kind="session",
        must_change_password=False,
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
        session_id="session",
    )
    directory = HttpAccountDirectory(
        principal=principal,
        assertion="proof",
        source_method="GET",
        source_path="source",
        credential="token",
        catalog=SimpleNamespace(),
    )
    directory.caller = CallerProfile(
        id="alpha",
        username="alpha",
        display_name="Alpha",
        active=True,
        platform_role="user",
        revision=1,
    )
    directory.checked_at = time.monotonic() - 6
    with pytest.raises(ThoughtError, match="过期"):
        await directory.current(principal)
    directory.checked_at = time.monotonic()
    assert (await directory.current(principal)).user_id == "alpha"


def test_public_directory_profile_has_no_credentials_or_private_fields():
    assert set(AccountProfile.model_fields) == {"id", "username", "display_name", "active"}
