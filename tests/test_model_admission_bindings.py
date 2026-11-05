"""HTTP, socket and spawned work use their explicit admission owner without SQL fallback."""

import asyncio
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException

from studio.apps.model_service.admission.bindings import AdmissionBindings
from studio.apps.model_service.transport.website.model_capacity import (
    ModelCapacity,
    model_capacity,
    spawned_task_admission,
    task_admission,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.http.authentication import SignedIdentity


def test_capacity_protocol_import_has_no_legacy_database_or_foreign_orm(tmp_path):
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import studio.apps.model_service.transport.website.model_capacity; "
            "import studio.apps.model_service.transport.website.models.model_test_realtime; "
            "assert 'studio.runtime.database.website' not in sys.modules; "
            "assert not any(n.startswith(('app.console.models', 'app.apps.', "
            "'studio.apps.asset_library.storage.models')) for n in sys.modules)",
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


class Session:
    def __init__(self):
        self.info = {}
        self.events = []
        self.fail_rollback = False

    async def commit(self):
        self.events.append("commit")

    async def rollback(self):
        self.events.append("rollback")
        if self.fail_rollback:
            raise RuntimeError("synthetic rollback failure")


def fixture():
    events = []
    session = Session()

    async def acquire(principal, **options):
        events.append(("acquire", principal.user_id, options))
        assert options.get("voice") is True or session.events[-1] == "commit"
        return "owned-lease"

    async def release(lease):
        events.append(("release", lease))

    async def attach(bound_session, lease, kind, ids):
        assert bound_session is session
        events.append(("attach", lease, kind, ids))

    async def admit(bound_session, principal, kind, ids):
        assert bound_session is session
        events.append(("spawn", principal.user_id, kind, ids))

    binding = AdmissionBindings(acquire, release, attach, admit)
    app = FastAPI()
    app.state.model_admission = binding
    principal = StudioPrincipal(
        user_id="alpha",
        platform_role="admin",
        auth_kind="session",
        must_change_password=False,
        scopes=frozenset(role_scopes("admin")),
        session_id="session-alpha",
    )

    async def body():
        return {}

    request = SimpleNamespace(
        app=app,
        state=SimpleNamespace(),
        method="POST",
        url=SimpleNamespace(path="/v1/model-inference/text"),
        json=body,
    )
    return request, session, principal, events


@pytest.mark.parametrize("end", ["normal", "cancel", "rollback_failure"])
async def test_reserved_capacity_is_released_on_close_cancellation_and_rollback_failure(end):
    request, session, principal, events = fixture()
    lifecycle = model_capacity(request, principal, session)
    await anext(lifecycle)
    assert request.state.model_admission_id == "owned-lease"
    assert events == [("acquire", "alpha", {"weight": 1})]
    await task_admission(request, session, "inference")(["task-alpha"])
    assert events[-1] == ("attach", "owned-lease", "inference", ["task-alpha"])
    if end == "cancel":
        with pytest.raises(asyncio.CancelledError):
            await lifecycle.athrow(asyncio.CancelledError())
    elif end == "rollback_failure":
        session.fail_rollback = True
        with pytest.raises(RuntimeError, match="rollback failure"):
            await lifecycle.aclose()
    else:
        await lifecycle.aclose()
    assert events[-1] == ("release", "owned-lease")
    assert session.events == ["commit", "rollback"]


async def test_queue_and_spawn_callbacks_use_the_same_installed_owner_without_a_reservation():
    request, session, principal, events = fixture()
    request.url.path = "/v1/visual-workshop/projects/project-alpha/generation-batches"

    async def body():
        return {"grid_size": 4}

    request.json = body
    lifecycle = model_capacity(request, principal, session)
    await anext(lifecycle)
    assert events == [] and request.state.visual_queue_principal is principal
    await task_admission(request, session, "visual")(["child-one", "child-two"])
    await spawned_task_admission(request, principal, "visual")(session, ["child-three"])
    await lifecycle.aclose()
    assert events == [
        ("spawn", "alpha", "visual", ["child-one", "child-two"]),
        ("spawn", "alpha", "visual", ["child-three"]),
    ]
    assert session.events == ["commit", "rollback"]


async def test_signed_http_requires_explicit_binding_but_read_only_routes_need_no_capacity():
    request, session, _principal, events = fixture()
    app = request.app

    @asynccontextmanager
    async def sessions():
        yield session

    app.state.database = SimpleNamespace(sessions=sessions)

    @app.post("/v1/model-inference/text", dependencies=[ModelCapacity])
    async def text():
        return {"ok": True}

    @app.get("/v1/model-inference/options", dependencies=[ModelCapacity])
    async def options():
        return {"items": []}

    key = Ed25519PrivateKey.generate()
    app.add_middleware(
        SignedIdentity,
        service="models",
        public_key=key.public_key(),
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
    )

    def headers(method, path):
        return {
            "X-Fpl-Context": issue_context(
                Actor("alpha", "admin", "session", tuple(role_scopes("admin")), session_id="s"),
                service="models",
                method=method,
                path=path,
                private_key=key,
                key_id="fixture",
            )
        }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://models"
    ) as client:
        binding = app.state.model_admission
        app.state.model_admission = None
        denied = await client.post(
            "/v1/model-inference/text", headers=headers("POST", "/v1/model-inference/text")
        )
        assert denied.status_code == 503
        assert denied.json()["detail"]["code"] == "model_admission_unavailable"
        assert events == []
        readable = await client.get(
            "/v1/model-inference/options", headers=headers("GET", "/v1/model-inference/options")
        )
        assert readable.status_code == 200 and events == []
        app.state.model_admission = binding
        allowed = await client.post(
            "/v1/model-inference/text", headers=headers("POST", "/v1/model-inference/text")
        )
        assert allowed.status_code == 200
        assert allowed.headers["cache-control"] == "no-store"
        assert events == [("acquire", "alpha", {"weight": 1}), ("release", "owned-lease")]


@pytest.mark.parametrize("mode", ["no_binding", "accept_failure", "run_failure"])
async def test_realtime_admission_is_explicit_and_releases_after_handshake_failure(
    monkeypatch, mode
):
    from studio.apps.model_service.transport.website.models import model_test_realtime as realtime

    request, session, principal, events = fixture()
    socket = SimpleNamespace(app=request.app)
    socket.headers = {"origin": "http://models", "host": "models"}
    socket.app.state.database = SimpleNamespace(sessions=lambda: None)
    closed = []

    async def close(**options):
        closed.append(options)

    async def accept():
        if mode == "accept_failure":
            raise RuntimeError("handshake failed")

    async def send_json(*_args, **_kwargs):
        raise AssertionError("The fake provider must not send data")

    async def authenticate(_socket):
        return principal

    async def run(_socket, **options):
        assert options["owner_user_id"] == "alpha"
        raise RuntimeError("provider failed")

    socket.accept, socket.close, socket.send_json = accept, close, send_json
    monkeypatch.setattr(realtime, "resolve_studio_websocket_principal", authenticate)
    monkeypatch.setattr(realtime, "run_realtime_model_test", run)
    if mode == "no_binding":
        socket.app.state.model_admission = None
        await realtime.realtime_socket(socket)
        assert closed == [{"code": 1013, "reason": "model_admission_unavailable"}]
        assert events == []
    else:
        with pytest.raises(RuntimeError, match="handshake failed|provider failed"):
            await realtime.realtime_socket(socket)
        assert events == [("acquire", "alpha", {"voice": True}), ("release", "owned-lease")]


async def test_missing_binding_rejects_spawned_work_instead_of_falling_back():
    request, _session, principal, events = fixture()
    request.app.state.model_admission = None
    with pytest.raises(HTTPException) as denied:
        spawned_task_admission(request, principal, "visual")
    assert denied.value.status_code == 503 and events == []
