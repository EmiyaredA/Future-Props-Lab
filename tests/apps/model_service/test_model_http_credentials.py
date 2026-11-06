"""Attribution uses verified Identity metadata without an account or global database lookup."""

import os
import subprocess
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException, WebSocket

from studio.assembly.http_dependencies import require_studio_auth
from studio.assembly.model_credentials import CallCredentialDep, socket_credential
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.model_service.credential_snapshot import CredentialSnapshot
from studio.runtime.http.authentication import SignedIdentity


def test_attribution_import_does_not_initialize_accounts_or_the_legacy_database(tmp_path):
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import studio.assembly.model_credentials; "
            "assert 'studio.runtime.database.website' not in sys.modules; "
            "assert not any(n.startswith('app.console.models') for n in sys.modules); "
            "assert not any(n.startswith('studio.apps.model_service.storage.models') "
            "for n in sys.modules)",
        ],
        cwd=root,
        env={
            **os.environ,
            "PYTHONPATH": str(root / "backend"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "FPL_SECRETS_KEY": "",
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.fixture
def application():
    sessions = []

    @asynccontextmanager
    async def factory():
        session = SimpleNamespace(info={})  # No SQL API exists in this service fixture.
        sessions.append(session)
        yield session

    app = FastAPI()
    app.state.database = SimpleNamespace(sessions=factory)

    @app.get("/v1/model-inference/options")
    async def attribution(credential: CallCredentialDep):
        return asdict(credential)

    key = Ed25519PrivateKey.generate()
    app.add_middleware(
        SignedIdentity,
        service="models",
        public_key=key.public_key(),
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
    )
    return app, key, sessions


def actor():
    return Actor(
        "alpha",
        "admin",
        "management_api_key",
        tuple(role_scopes("admin")),
        api_key_id="key-alpha",
        api_key_name="日志归因",
        api_key_prefix="fpl_fixture",
    )


def headers(key, identity=None):
    return {
        "X-Fpl-Context": issue_context(
            identity or actor(),
            service="models",
            method="GET",
            path="/v1/model-inference/options",
            private_key=key,
            key_id="fixture",
        )
    }


async def test_signed_key_metadata_and_session_attribution_need_no_account_table(application):
    app, key, sessions = application
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://models"
    ) as client:
        result = await client.get("/v1/model-inference/options", headers=headers(key))
        assert result.status_code == 200, result.text
        assert result.json() == {
            "auth_kind": "management_api_key",
            "api_key_id": "key-alpha",
            "api_key_name": "日志归因",
            "api_key_prefix": "fpl_fixture",
        }
        assert sessions[-1].info["owner_user_id"] == "alpha"
        assert result.headers["cache-control"] == "no-store"
        session_actor = Actor(
            "beta", "user", "session", tuple(role_scopes("user")), session_id="session-beta"
        )
        session_result = await client.get(
            "/v1/model-inference/options", headers=headers(key, session_actor)
        )
        assert session_result.json() == asdict(CredentialSnapshot(auth_kind="session"))
        assert sessions[-1].info["owner_user_id"] == "beta"
        before = len(sessions)
        denied = await client.get(
            "/v1/model-inference/options", headers={"Cookie": "fpl_session=forged"}
        )
        assert denied.status_code == 401 and len(sessions) == before


@pytest.mark.parametrize("field,value", [("user_id", "beta"), ("api_key_id", "other-key")])
async def test_principal_must_match_the_verified_attribution_actor(application, field, value):
    app, key, _sessions = application
    principal = StudioPrincipal(
        user_id="alpha",
        platform_role="admin",
        must_change_password=False,
        auth_kind="management_api_key",
        scopes=frozenset(role_scopes("admin")),
        api_key_id="key-alpha",
    )
    app.dependency_overrides[require_studio_auth] = lambda: replace(principal, **{field: value})
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://models"
    ) as client:
        result = await client.get("/v1/model-inference/options", headers=headers(key))
        assert result.status_code == 401
        assert result.json()["detail"]["code"] == "credential_context_required"


async def test_recovery_reader_uses_the_authenticated_application_session(application):
    app, key, sessions = application
    calls = []

    async def reader(session, principal):
        calls.append((session, principal.user_id))
        return CredentialSnapshot(auth_kind="management_api_key", api_key_name="Recovery")

    app.state.model_credential_reader = reader
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://models"
    ) as client:
        result = await client.get("/v1/model-inference/options", headers=headers(key))
        assert result.status_code == 200 and result.json()["api_key_name"] == "Recovery"
        assert calls == [(sessions[-1], "alpha")]
        assert sessions[-1].info["owner_user_id"] == "alpha"


async def test_socket_attribution_is_browser_only_and_legacy_lookup_is_explicit(application):
    app, _key, sessions = application

    async def unused(*_args):
        raise AssertionError("Attribution must not read or write socket frames")

    socket = WebSocket(
        {"type": "websocket", "app": app, "path": "/v1/model-test/realtime"}, unused, unused
    )
    principal = StudioPrincipal(
        user_id="alpha",
        platform_role="admin",
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset(role_scopes("admin")),
        session_id="session-alpha",
    )
    assert await socket_credential(socket, principal) == CredentialSnapshot(auth_kind="session")
    assert sessions == []
    with pytest.raises(HTTPException) as denied:
        await socket_credential(
            socket,
            replace(principal, auth_kind="management_api_key", session_id=None, api_key_id="key"),
        )
    assert denied.value.status_code == 403 and sessions == []
    calls = []

    async def reader(session, identity):
        calls.append((session, identity))
        return CredentialSnapshot(auth_kind="session")

    app.state.model_credential_reader = reader
    assert await socket_credential(socket, principal) == CredentialSnapshot(auth_kind="session")
    assert calls == [(sessions[-1], principal)]
