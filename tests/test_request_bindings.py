"""Route dependencies use each app's explicit sessions and authentication strategy."""

import os
import subprocess
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request
from starlette.websockets import WebSocket

from studio.assembly.http_dependencies import (
    authenticate_studio_request,
    authenticate_studio_websocket,
    db_session,
)
from studio.contracts.identity.claims import Actor


def test_shared_dependency_import_does_not_open_legacy_configuration_or_account_storage():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; import studio.assembly.http_dependencies; "
                "assert 'studio.runtime.database.website' not in sys.modules; "
                "assert 'studio.apps.identity.storage.models.accounts' not in sys.modules; "
                "assert 'studio.assembly.website.application' not in sys.modules"
            ),
        ],
        env={
            **os.environ,
            "PYTHONPATH": "backend",
            "FPL_SECRETS_KEY": "",
            "FPL_CONFIG_FILE": "/nonexistent/fpl-test.toml",
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def connection(app, owner=None, *, socket=False):
    scope = {
        "type": "websocket" if socket else "http",
        "app": app,
        "path": "/v1/model-inference/options",
        "method": "GET",
        "scheme": "http",
        "headers": [],
        "query_string": b"",
        "state": {},
    }
    if owner:
        scope["state"]["service_actor"] = Actor(
            owner,
            "user",
            "session",
            ("studio:read", "studio:private_read"),
            session_id="session-" + owner,
        )

    async def unused_transport(*_args):
        raise AssertionError("Authentication must not use socket transport")

    return WebSocket(scope, unused_transport, unused_transport) if socket else Request(scope)


def application(tag):
    app, closed = FastAPI(), []

    @asynccontextmanager
    async def sessions():
        try:
            yield SimpleNamespace(info={}, tag=tag)
        finally:
            closed.append(tag)

    app.state.database = SimpleNamespace(sessions=sessions)
    return app, closed


async def test_two_apps_do_not_change_each_others_session_factory_or_owner():
    first, closed_first = application("first")
    second, closed_second = application("second")
    for app, owner, tag in ((first, "alpha", "first"), (second, "beta", "second")):
        request = connection(app, owner)
        async for session in db_session(request):
            principal = await authenticate_studio_request(
                request, session, required_scope="studio:read"
            )
            assert principal.user_id == owner
            assert session.info["owner_user_id"] == owner and session.tag == tag
    assert closed_first == ["first"] and closed_second == ["second"]


async def test_unbound_business_auth_does_not_fall_back_to_cookie_or_account_database():
    app, closed = application("business")
    request = connection(app)
    request.scope["headers"] = [(b"cookie", b"fpl_session=looks-like-a-session")]
    async for session in db_session(request):
        with pytest.raises(HTTPException) as error:
            await authenticate_studio_request(request, session, required_scope="studio:read")
        assert error.value.status_code == 401
    assert closed == ["business"]
    with pytest.raises(HTTPException) as error:
        await authenticate_studio_websocket(connection(app, socket=True), SimpleNamespace(info={}))
    assert error.value.status_code == 401


async def test_http_authentication_is_explicitly_dispatched_to_the_installed_adapter():
    app, _closed = application("identity")
    calls = []

    async def authenticate(request, session, **options):
        calls.append((request.app is app, session.tag, options))
        return "adapter-result"

    app.state.studio_http_auth = authenticate
    request = connection(app)
    async for session in db_session(request):
        assert (
            await authenticate_studio_request(
                request,
                session,
                required_scope="studio:read",
                allow_forced_password_change=True,
            )
            == "adapter-result"
        )
    assert calls == [
        (True, "identity", {"required_scope": "studio:read", "allow_forced_password_change": True})
    ]
