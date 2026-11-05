"""Private Models inputs are owned library files, with no browser or project access."""

import io
import time
import wave
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.asset_library.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.runtime.database.migrations import apply


class Dependencies:
    async def project_exists(self, **_body):
        return False

    async def close(self):
        pass


def proof(key, path, *, owner="alpha", purpose="studio", audience="assets", now=None):
    return {
        "X-Fpl-Context": issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id="fixture-session",
                purpose=purpose,
            ),
            service=audience,
            method="GET",
            path=path,
            private_key=key,
            key_id="fixture",
            now=now,
        )
    }


def audio():
    result = io.BytesIO()
    with wave.open(result, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b"\0\0" * 800)
    return result.getvalue()


@pytest.fixture
async def instance(tmp_path):
    key = Ed25519PrivateKey.generate()
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    app = create_app(
        settings=StorageSettings(tmp_path / "service.db"),
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
        public_key=key.public_key(),
        identity=Dependencies(),
        capabilities=Dependencies(),
        cleanup=False,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://assets"
        ) as client:
            token = issue_context(
                Actor(
                    "alpha",
                    "user",
                    "session",
                    ("studio:read", "studio:private_read", "studio:write"),
                    session_id="fixture-session",
                ),
                service="assets",
                method="POST",
                path="/v1/files",
                private_key=key,
                key_id="fixture",
            )
            uploaded = await client.post(
                "/v1/files",
                headers={"X-Fpl-Context": token},
                files={"upload": ("听写 样例.wav", audio(), "audio/wav")},
            )
            assert uploaded.status_code == 200, uploaded.text
            yield app, client, key, uploaded.json()["id"]


async def test_private_library_file_has_exact_bytes_unicode_name_and_no_public_contract(instance):
    app, client, key, asset_id = instance
    path = "/_internal/v1/model-library-inputs/" + asset_id
    response = await client.get(path, headers=proof(key, path))
    assert response.status_code == 200 and response.content == audio()
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-fpl-file-kind"] == "audio"
    assert int(response.headers["content-length"]) == len(audio())
    assert not any(path.startswith("/_internal/") for path in app.openapi()["paths"])


@pytest.mark.parametrize(
    "field",
    [
        "project_id",
        "galgame_project_id",
        "video_editor_project_id",
        "motion_compositor_project_id",
    ],
)
async def test_project_storage_fixture_cannot_be_read_as_a_library_input(instance, field):
    app, client, key, asset_id = instance
    # Storage fixture only: construct each owned historical scope in a temporary DB.
    async with app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(VisualAsset, asset_id)
        setattr(row, field, "fixture-project")
        await session.commit()
    path = "/_internal/v1/model-library-inputs/" + asset_id
    response = await client.get(path, headers=proof(key, path))
    assert response.status_code == 404, response.text


@pytest.mark.parametrize(
    "fault,status",
    [
        ("missing", 401),
        ("foreign", 404),
        ("origin", 403),
        ("cookie", 403),
        ("purpose", 403),
        ("audience", 401),
        ("path", 401),
        ("expired", 401),
    ],
)
async def test_private_input_rejects_invalid_or_browser_authority(instance, fault, status):
    _app, client, key, asset_id = instance
    path = "/_internal/v1/model-library-inputs/" + asset_id
    options = {}
    if fault == "foreign":
        options["owner"] = "beta"
    if fault == "purpose":
        options["purpose"] = "management"
    if fault == "audience":
        options["audience"] = "models"
    if fault == "expired":
        options["now"] = int(time.time()) - 120
    headers = proof(key, path + ("-another" if fault == "path" else ""), **options)
    if fault == "missing":
        headers = {}
    if fault == "origin":
        headers["Origin"] = "http://browser"
    if fault == "cookie":
        headers["Cookie"] = "fpl_session=untrusted"
    response = await client.get(path, headers=headers)
    assert response.status_code == status, response.text
