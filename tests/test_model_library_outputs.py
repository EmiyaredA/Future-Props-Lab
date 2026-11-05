"""Owned Models results are delivered through narrow, recoverable Assets receipts."""

import asyncio
import hashlib
import io
import os
import subprocess
import sys
import wave
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import func, select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.library_outputs import library_outputs
from fpl_assets.application import create_app
from fpl_assets.library_outputs import LibraryOutputFiles
from fpl_assets.migrations.registry import MIGRATIONS
from fpl_assets.models import ModelLibraryOutputReceipt
from fpl_assets.settings import StorageSettings
from fpl_models.library_outputs import HttpLibraryOutputs
from fpl_runtime.capability_client import CapabilityClient, CapabilityDenied
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.delegation import RequestGrant, permitted, target_permission_path
from fpl_runtime.migrations import apply
from fpl_runtime.model_outputs import ModelOutputDescription, model_output_path
from fpl_runtime.routing import RouteCatalog


def audio(frames=800):
    result = io.BytesIO()
    with wave.open(result, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * frames)
    return result.getvalue()


def description(content=None):
    content = audio() if content is None else content
    return ModelOutputDescription(
        "模型结果 样例.wav", "audio/wav", len(content), hashlib.sha256(content).hexdigest()
    )


class Dependencies:
    def __init__(self):
        self.decisions = [True]

    async def status(self, **_request):
        return self.decisions.pop(0) if len(self.decisions) > 1 else self.decisions[0]

    async def project_exists(self, **_request):
        return False

    async def close(self):
        pass


@pytest.fixture
async def instance(tmp_path):
    key, dependencies = Ed25519PrivateKey.generate(), Dependencies()
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    app = create_app(
        settings=StorageSettings(tmp_path / "service.db"),
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
        public_key=key.public_key(),
        identity=dependencies,
        capabilities=dependencies,
        cleanup=False,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://assets"
        ) as client:
            yield app, client, key, dependencies


def proof(key, path, *, owner="alpha", purpose="studio", audience="assets", scopes=None):
    return {
        "X-Fpl-Context": issue_context(
            Actor(
                owner,
                "user",
                "session",
                scopes or ("studio:read", "studio:private_read", "studio:write"),
                session_id="synthetic-session",
                purpose=purpose,
            ),
            service=audience,
            method="POST",
            path=path,
            private_key=key,
            key_id="fixture",
        )
    }


def request_headers(key, *, item=None, task="task-one", **proof_options):
    item = description() if item is None else item
    path = model_output_path(task, item.fingerprint)
    return path, {
        **proof(key, path, **proof_options),
        "X-Fpl-Output-Descriptor": item.header(),
        "Content-Length": str(item.byte_size),
        "Content-Type": "application/octet-stream",
    }


async def count_outputs(app, owner="alpha"):
    async with app.state.database.sessions(info={"owner_user_id": owner}) as session:
        receipts = await session.scalar(select(func.count()).select_from(ModelLibraryOutputReceipt))
        files = await session.scalar(select(func.count()).select_from(VisualAsset))
        return receipts, files


async def test_private_output_is_owned_atomic_and_replay_does_not_duplicate_files(instance):
    app, client, key, _dependencies = instance
    path, headers = request_headers(key)
    first = await client.post(path, headers=headers, content=audio())
    second = await client.post(path, headers=headers, content=audio())
    assert first.status_code == second.status_code == 200, first.text + second.text
    assert first.json() == second.json()
    assert first.json()["original_filename"] == "模型结果 样例.wav"
    assert first.headers["cache-control"] == "no-store"
    assert await count_outputs(app) == (1, 1)
    async with app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(VisualAsset, first.json()["id"])
        assert AssetStorage(app.state.settings).path_for(row).read_bytes() == audio()
        assert row.project_id is row.galgame_project_id is row.video_editor_project_id is None
    assert await count_outputs(app, "beta") == (0, 0)
    assert path not in app.openapi()["paths"]


async def test_simultaneous_retries_publish_one_result(instance):
    app, client, key, _dependencies = instance
    path, headers = request_headers(key)
    responses = await asyncio.gather(
        *(client.post(path, headers=headers, content=audio()) for _ in range(3))
    )
    assert [response.status_code for response in responses] == [200] * 3
    assert len({response.json()["id"] for response in responses}) == 1
    assert await count_outputs(app) == (1, 1)
    root = app.state.settings.account_path("alpha")
    assert len([p for p in root.rglob("*") if p.is_file()]) == 1


@pytest.mark.parametrize(
    "fault,status",
    [
        ("digest", 422),
        ("length", 422),
        ("descriptor", 422),
        ("compressed", 422),
        ("cookie", 403),
        ("origin", 403),
        ("audience", 401),
        ("purpose", 403),
        ("missing", 401),
        ("scope", 403),
    ],
)
async def test_output_refuses_invalid_bytes_or_authority_without_files(instance, fault, status):
    app, client, key, _dependencies = instance
    options = {}
    if fault == "audience":
        options["audience"] = "models"
    if fault == "purpose":
        options["purpose"] = "management"
    if fault == "scope":
        options["scopes"] = ("studio:read", "studio:private_read")
    path, headers = request_headers(key, **options)
    body = audio()
    if fault == "digest":
        body = body[:-1] + b"\1"
    if fault == "length":
        headers["Content-Length"] = str(len(body) + 1)
    if fault == "descriptor":
        headers["X-Fpl-Output-Descriptor"] = description(body + b"x").header()
    if fault == "compressed":
        headers["Content-Encoding"] = "gzip"
    if fault in {"cookie", "origin"}:
        headers[fault] = "synthetic"
    if fault == "missing":
        headers.pop("X-Fpl-Context")
    response = await client.post(path, headers=headers, content=body)
    assert response.status_code == status, response.text
    assert await count_outputs(app) == (0, 0)
    assert not any(p.is_file() for p in app.state.settings.account_path("alpha").rglob("*"))


async def test_large_output_stream_uses_owned_disk_without_internal_json_body_limit(instance):
    app, client, key, _dependencies = instance
    body = audio(frames=1_100_000)
    path, headers = request_headers(key, item=description(body))
    result = await client.post(path, headers=headers, content=body)
    assert result.status_code == 200, result.text
    assert result.json()["byte_size"] == len(body)
    assert await count_outputs(app) == (1, 1)


@pytest.mark.parametrize("decision,status", [(False, 401), (None, 503)])
async def test_revocation_or_identity_failure_after_transfer_leaves_no_file(
    instance, decision, status
):
    app, client, key, dependencies = instance
    dependencies.decisions = [True, decision]
    path, headers = request_headers(key)
    result = await client.post(path, headers=headers, content=audio())
    assert result.status_code == status, result.text
    assert await count_outputs(app) == (0, 0)
    assert not any(p.is_file() for p in app.state.settings.account_path("alpha").rglob("*"))


class Incoming:
    def __init__(self, body):
        self.filename, self.content_type = "模型结果 样例.wav", "audio/wav"
        self.source = io.BytesIO(body)

    async def read(self, size=-1):
        return self.source.read(size)

    async def close(self):
        self.source.close()


async def test_unknown_commit_keeps_published_bytes_and_replays_original_receipt(
    instance, monkeypatch
):
    app, _client, _key, dependencies = instance
    async with app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        original = session.commit

        async def lost_acknowledgement():
            await original()
            raise RuntimeError("synthetic lost commit acknowledgement")

        monkeypatch.setattr(session, "commit", lost_acknowledgement)
        with pytest.raises(RuntimeError, match="lost commit"):
            await LibraryOutputFiles(
                session, app.state.settings, "alpha", active=lambda: dependencies.status()
            ).store("task-one", description(), Incoming(audio()))
    assert await count_outputs(app) == (1, 1)
    async with app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        result = await LibraryOutputFiles(
            session, app.state.settings, "alpha", active=lambda: dependencies.status()
        ).store("task-one", description(), Incoming(b"must not be read for a known receipt"))
        row = await session.get(VisualAsset, result.id)
        assert AssetStorage(app.state.settings).path_for(row).read_bytes() == audio()
    assert await count_outputs(app) == (1, 1)


def test_output_delegation_binds_source_task_target_and_required_permission():
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    grant = RequestGrant(
        "models",
        "models.library-output.write",
        "POST",
        "/v1/model-inference/tasks/task-one/save-to-library",
        "assets",
        "POST",
        model_output_path("task-one", description().fingerprint),
    )
    assert permitted(grant, catalog)
    assert target_permission_path(grant) == "/v1/files"
    for changes in (
        {"caller": "agents"},
        {"purpose": "rendering.source.read"},
        {"target_method": "GET"},
        {"target_service": "models"},
        {"source_path": "/v1/model-inference/tasks/task-two/save-to-library"},
        {"target_path": "/v1/files"},
    ):
        assert not permitted(replace(grant, **changes), catalog)


def test_output_port_does_not_fall_back_to_foreign_storage():
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    session = SimpleNamespace(info={"owner_user_id": "alpha"})
    with pytest.raises(Exception) as failure:
        library_outputs(request, session, "alpha")
    assert failure.value.status_code == 503
    with pytest.raises(Exception) as failure:
        library_outputs(request, session, "beta")
    assert failure.value.status_code == 403


async def test_http_output_preserves_source_and_passes_only_the_fixed_result(instance, tmp_path):
    _app, _client, _key, _dependencies = instance
    local = tmp_path / "models-output"
    local.write_bytes(audio())
    observed = []

    class Server:
        async def model_library_output(self, **data):
            observed.append(data)
            assert b"".join([part async for part in data["content"]]) == audio()
            raise CapabilityDenied(403)

    adapter = HttpLibraryOutputs(
        Server(),
        assertion="source-proof",
        method="POST",
        path="/v1/model-inference/tasks/task-one/save-to-library",
        max_bytes=1_000_000,
    )
    with pytest.raises(AssetError) as denied:
        await adapter.save("task-one", local, "模型结果 样例.wav", "audio/wav")
    assert denied.value.status == 403 and local.read_bytes() == audio()
    assert observed[0]["task_id"] == "task-one"
    assert observed[0]["description"] == description()


async def test_capability_client_authorizes_before_sending_and_refuses_redirects():
    requests = []

    async def handler(request):
        requests.append(request)
        if request.url.host == "identity":
            return httpx.Response(200, json={"assertion": "narrow-proof"})
        return httpx.Response(307, headers={"Location": "https://external.invalid"})

    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    client = CapabilityClient(
        service="models",
        credential="synthetic",
        catalog=catalog,
        transport=httpx.MockTransport(handler),
    )
    try:
        from fpl_runtime.capability_client import CapabilityUnavailable

        with pytest.raises(CapabilityUnavailable):
            await client.model_library_output(
                assertion="source-proof",
                source_method="POST",
                source_path="/v1/model-inference/tasks/task-one/save-to-library",
                task_id="task-one",
                description=description(),
                content=audio(),
            )
        assert [request.url.host for request in requests] == ["identity", "assets"]
        assert requests[1].headers["X-Fpl-Context"] == "narrow-proof"
    finally:
        await client.close()


def test_generation_and_output_consumers_import_without_foreign_orm_or_database(tmp_path):
    code = """
import sys
from app.llm.inference.tasks import InferenceTasks
from app.llm.playground.generation_assets import ModelTestGenerationAssets
from app.llm.playground.generation_runner import ModelTestGenerationRunner
from app.llm.playground.attachments import ModelTestAttachments
from app.llm.routes.model_inference import router
from app.llm.routes.models.model_test_generation import router
for module in ('app.runtime.db', 'app.orm', 'app.capabilities.asset_store.models',
    'app.console.models.accounts', 'app.apps.visual_workshop.models'):
    assert module not in sys.modules, module
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PYTHONPATH": str(Path("backend").resolve()),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "FPL_DATABASE_PATH": str(tmp_path / "unused.db"),
        },
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def test_real_identity_delegation_checks_credentials_live_session_and_logout(
    instance, tmp_path, monkeypatch
):
    from fpl_identity.accounts import create_account
    from fpl_identity.application import create_app as create_identity
    from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
    from fpl_runtime.identity_client import LiveAuthorization

    app, _client, key, _dependencies = instance
    identity_root = tmp_path / "identity"
    apply(identity_root / "service.db", "identity", IDENTITY_MIGRATIONS)
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    monkeypatch.setattr(
        "fpl_identity.application.get_settings",
        lambda: SimpleNamespace(database_path=identity_root / "service.db"),
    )
    origin = "http://127.0.0.1:19000"
    gateway, model_token, asset_token = [
        value * 3 for value in ("synthetic-gateway-", "synthetic-models-", "synthetic-assets-")
    ]
    identity = create_identity(
        state_root=identity_root,
        catalog=catalog,
        gateway_token=gateway,
        local_origin=origin,
        public_origin="https://studio.example.test",
        private_key=key,
        service_credentials={"models": model_token, "assets": asset_token},
    )

    class Routing(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            target = {"identity": identity, "assets": app}[request.url.host]
            return await httpx.ASGITransport(app=target).handle_async_request(request)

    routing = Routing()
    live = LiveAuthorization(service="assets", credential=asset_token, transport=routing)
    app.state.identity = live
    capabilities = CapabilityClient(
        service="models", credential=model_token, catalog=catalog, transport=routing
    )
    try:
        async with identity.router.lifespan_context(identity):
            password = "Synthetic-Library-Output-2026!"
            async with identity.state.database.sessions() as session:
                await create_account(
                    session,
                    username="output-fixture",
                    display_name="output",
                    password=password,
                    platform_role="user",
                )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=identity),
                base_url=origin,
                headers={"X-Fpl-Gateway": gateway, "X-Fpl-Ingress": "local"},
            ) as browser:
                login = await browser.post(
                    "/v1/auth/login", json={"username": "output-fixture", "password": password}
                )
                assert login.status_code == 200, login.text
                owner = login.json()["user"]["id"]
                unsafe = {"Origin": origin, "X-CSRF-Token": browser.cookies.get("fpl_csrf")}
                source = "/v1/model-inference/tasks/task-one/save-to-library"
                authenticated = await browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        **unsafe,
                        "X-Fpl-Target-Service": "models",
                        "X-Fpl-Request-Method": "POST",
                        "X-Fpl-Request-Uri": source,
                    },
                )
                assert authenticated.status_code == 204, authenticated.text
                assertion = authenticated.headers["X-Fpl-Context"]
                local = tmp_path / "actual-model-output"
                local.write_bytes(audio())
                output = HttpLibraryOutputs(
                    capabilities,
                    assertion=assertion,
                    method="POST",
                    path=source,
                    max_bytes=1_000_000,
                )
                result = await output.save("task-one", local, "模型结果 样例.wav", "audio/wav")
                assert result.original_filename == "模型结果 样例.wav"
                replay = await output.save("task-one", local, "模型结果 样例.wav", "audio/wav")
                assert replay.id == result.id and await count_outputs(app, owner) == (1, 1)
                async with httpx.AsyncClient(transport=routing) as raw:
                    wrong_credential = await raw.post(
                        "http://identity/_internal/v1/authorization/delegate",
                        headers={"Authorization": "Bearer " + asset_token},
                        json={
                            "caller": "models",
                            "purpose": "models.library-output.write",
                            "source_method": "POST",
                            "source_path": source,
                            "target_service": "assets",
                            "target_method": "POST",
                            "target_path": model_output_path("task-one", description().fingerprint),
                            "assertion": assertion,
                        },
                    )
                    assert wrong_credential.status_code == 403
                assert (await browser.post("/v1/auth/logout", headers=unsafe)).status_code == 204
                with pytest.raises(AssetError) as revoked:
                    await output.save("task-one", local, "模型结果 样例.wav", "audio/wav")
                assert revoked.value.status == 401
                assert local.read_bytes() == audio()
    finally:
        await capabilities.close()
        await live.close()
