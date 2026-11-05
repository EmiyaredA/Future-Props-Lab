"""Thought metadata and export bytes use request-bound, owner-checked Assets HTTP."""

import io
import json
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from starlette.datastructures import UploadFile

from app.capabilities.asset_store.library import AssetLibrary
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.asset_metadata import HttpAssetMetadata
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.website.asset_metadata import LibraryAsset, metadata
from studio.assembly.independent.asset_library.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.delegation import RequestGrant, permitted, target_permission_path
from studio.contracts.thought_workshop.thought_assets import PREFIX, AssetQuery
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
CATALOG = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")


class Dependencies:
    async def close(self):
        pass

    async def status(self, **_kwargs):
        return True


@pytest.fixture
async def instance(tmp_path):
    settings = StorageSettings(tmp_path / "service.db")
    apply(settings.database_path, "assets", MIGRATIONS)
    key, dependencies = Ed25519PrivateKey.generate(), Dependencies()
    app = create_app(
        settings=settings,
        catalog=CATALOG,
        public_key=key.public_key(),
        identity=dependencies,
        capabilities=dependencies,
        cleanup=False,
    )
    async with app.router.lifespan_context(app):
        async with app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await AssetLibrary(session, settings).store_upload(
                UploadFile(io.BytesIO(b"private note attachment"), filename="note.txt"),
                owner_user_id="alpha",
            )
            asset_id = row.id
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://assets"
        ) as client:
            yield app, client, key, asset_id


def proof(key, method, path, owner="alpha", **actor_changes):
    return {
        "X-Fpl-Context": issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id="synthetic",
                **actor_changes,
            ),
            service="assets",
            method=method,
            path=path,
            private_key=key,
            key_id="fixture",
        )
    }


def test_fixed_grant_rejects_wrong_source_purpose_and_destination():
    query = AssetQuery(asset_ids=["alpha-file"])
    values = dict(
        caller="thought",
        purpose="thought.library.read",
        source_method="GET",
        source_path="/v1/thought-workshop/backup",
        target_service="assets",
        target_method="POST",
        target_path=query.path,
    )
    assert permitted(RequestGrant(**values), CATALOG)
    assert target_permission_path(RequestGrant(**values)) == "/v1/files"
    for patch in (
        {"caller": "models"},
        {"purpose": "arbitrary"},
        {"target_service": "thought"},
        {"source_path": "/v1/community/publications"},
        {"source_method": "PUT"},
        {"target_path": PREFIX + "/metadata/not-a-digest"},
        {"target_method": "GET"},
    ):
        assert not permitted(RequestGrant(**{**values, **patch}), CATALOG)
    assert query.digest == AssetQuery(asset_ids=["alpha-file"]).digest
    assert query.digest != AssetQuery(asset_ids=["beta-file"]).digest


def test_upload_grant_binds_source_endpoint_kind_request_and_digest():
    values = dict(
        caller="thought",
        purpose="thought.library.upload",
        source_method="POST",
        source_path="/v1/thought-workshop/images",
        target_service="assets",
        target_method="POST",
        target_path=PREFIX + "/uploads/image/operation/" + "a" * 64,
    )
    assert permitted(RequestGrant(**values), CATALOG)
    assert permitted(RequestGrant(**{**values, "target_method": "GET"}), CATALOG)
    assert target_permission_path(RequestGrant(**values)) == "/v1/files"
    for patch in (
        {"source_path": "/v1/thought-workshop/attachments"},
        {"source_method": "GET"},
        {"target_method": "DELETE"},
        {"target_path": PREFIX + "/uploads/attachment/operation/" + "a" * 64},
        {"target_path": PREFIX + "/uploads/image/operation/not-a-digest"},
        {"target_path": PREFIX + "/uploads/image/../" + "a" * 64},
        {"caller": "models"},
        {"purpose": "thought.library.read"},
    ):
        assert not permitted(RequestGrant(**{**values, **patch}), CATALOG)
    attachment = {
        **values,
        "source_path": "/v1/thought-workshop/attachments",
        "target_path": PREFIX + "/uploads/attachment/operation/" + "b" * 64,
    }
    assert permitted(RequestGrant(**attachment), CATALOG)


async def test_metadata_is_private_owner_bound_and_digest_bound(instance):
    _app, client, key, asset_id = instance
    query = AssetQuery(asset_ids=[asset_id])
    headers = proof(key, "POST", query.path)
    result = await client.post(query.path, headers=headers, json=query.model_dump())
    assert result.status_code == 200, result.text
    item = result.json()["items"][0]
    assert set(item) == set(LibraryAsset.__dataclass_fields__)
    assert item["original_filename"] == "note.txt"
    assert not any(word in result.text for word in ("storage_key", "owner_user_id", "/accounts/"))
    assert result.headers["Cache-Control"] == "no-store"
    assert (
        await client.post(
            query.path, headers=proof(key, "POST", query.path, "beta"), json=query.model_dump()
        )
    ).status_code == 404
    assert (
        await client.post(query.path, headers=headers, json={"asset_ids": ["missing"]})
    ).status_code == 403
    assert (
        await client.post(
            query.path, headers={**headers, "Origin": "http://browser"}, json=query.model_dump()
        )
    ).status_code == 403
    assert (
        await client.post(
            query.path, headers={**headers, "Cookie": "session=present"}, json=query.model_dump()
        )
    ).status_code == 403
    assert (await client.post(query.path, json=query.model_dump())).status_code == 401
    assert (
        await client.post(
            query.path,
            headers=proof(key, "POST", query.path, purpose="management"),
            json=query.model_dump(),
        )
    ).status_code == 403
    changed = {**query.model_dump(), "owner_user_id": "alpha"}
    assert (await client.post(query.path, headers=headers, json=changed)).status_code == 422


async def test_content_requires_exact_revision_and_owner(instance):
    _app, client, key, asset_id = instance
    path = PREFIX + "/content/" + asset_id + "/0"
    response = await client.get(path, headers=proof(key, "GET", path))
    assert response.status_code == 200 and response.content == b"private note attachment", (
        response.text
    )
    assert response.headers["X-Fpl-File-Revision"] == "0"
    assert (await client.get(path, headers=proof(key, "GET", path, "beta"))).status_code == 404
    changed = path[:-1] + "1"
    assert (await client.get(changed, headers=proof(key, "GET", changed))).status_code == 409
    assert (await client.get(changed, headers=proof(key, "GET", path))).status_code == 401


async def test_real_assets_http_is_consumed_without_storage_paths(instance, tmp_path):
    app, _client, key, asset_id = instance
    assets = httpx.ASGITransport(app=app)

    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            if request.url.host == "identity":
                body = json.loads(request.content)
                grant = RequestGrant(**{k: body[k] for k in RequestGrant.__dataclass_fields__})
                assert permitted(grant, CATALOG)
                return httpx.Response(
                    200,
                    json={
                        "assertion": proof(key, body["target_method"], body["target_path"])[
                            "X-Fpl-Context"
                        ]
                    },
                )
            return await assets.handle_async_request(request)

    port = HttpAssetMetadata(
        assertion="original-request-proof",
        source_method="GET",
        source_path="/v1/thought-workshop/backup",
        credential="service-secret",
        catalog=CATALOG,
        transport=Transport(),
    )
    result = await port.describe({asset_id})
    target = tmp_path / "copy.txt"
    await port.download(result[asset_id], target)
    assert target.read_bytes() == b"private note attachment"
    with pytest.raises(FileExistsError):
        await port.download(result[asset_id], target)
    assert target.read_bytes() == b"private note attachment"


async def test_unbound_or_mismatched_session_never_falls_back_to_assets_database():
    from types import SimpleNamespace

    with pytest.raises(ThoughtError, match="尚未连接"):
        metadata(SimpleNamespace(info={"owner_user_id": "alpha"}), "alpha")
    with pytest.raises(ThoughtError, match="不匹配"):
        metadata(SimpleNamespace(info={"owner_user_id": "alpha"}), "beta")


async def test_interrupted_download_removes_only_its_partial_file(tmp_path):
    asset = LibraryAsset("a", "a.txt", "text/plain", "file", 10, 0)

    def handler(request):
        if request.url.host == "identity":
            return httpx.Response(200, json={"assertion": "synthetic"})
        return httpx.Response(
            200, headers={"Content-Length": "10", "X-Fpl-File-Revision": "0"}, content=b"short"
        )

    port = HttpAssetMetadata(
        assertion="proof",
        source_method="GET",
        source_path="/v1/thought-workshop/backup",
        credential="service-secret",
        catalog=CATALOG,
        transport=httpx.MockTransport(handler),
    )
    target = tmp_path / "partial"
    with pytest.raises(ThoughtError, match="未完成"):
        await port.download(asset, target)
    assert not target.exists()


async def test_creation_prefetches_before_writer_reservation(instance, tmp_path):
    from sqlalchemy import event

    from studio.apps.thought_workshop.directory import Directory
    from studio.apps.thought_workshop.knowledge import KnowledgeBases
    from studio.apps.thought_workshop.schemas.knowledge import KnowledgeBaseIn
    from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteCreate
    from studio.apps.thought_workshop.storage.migrations.registry import (
        MIGRATIONS as THOUGHT_MIGRATIONS,
    )
    from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
    from studio.runtime.database.sessions import Database

    app, _client, key, asset_id = instance
    root = tmp_path / "thought"
    apply(root / "service.db", "thought", THOUGHT_MIGRATIONS)
    database = Database("thought", root, models=MODELS, account_models=ACCOUNT_MODELS)
    assets = httpx.ASGITransport(app=app)
    wrote = False
    network = 0

    @event.listens_for(database.engine.sync_engine, "before_cursor_execute")
    def record_write(_connection, _cursor, statement, _parameters, _context, _many):
        nonlocal wrote
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            wrote = True

    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            nonlocal network
            assert not wrote, "Cross-service validation held the Thought writer lock"
            network += 1
            if request.url.host == "identity":
                body = json.loads(request.content)
                return httpx.Response(
                    200,
                    json={
                        "assertion": proof(key, body["target_method"], body["target_path"])[
                            "X-Fpl-Context"
                        ]
                    },
                )
            return await assets.handle_async_request(request)

    port = HttpAssetMetadata(
        assertion="original",
        source_method="POST",
        source_path="/v1/thought-workshop/notes",
        credential="service-secret",
        catalog=CATALOG,
        transport=Transport(),
    )
    try:
        async with database.sessions(
            info={
                "owner_user_id": "alpha",
                "thought_asset_metadata_factory": lambda _session, _owner: port,
            }
        ) as session:
            knowledge = await KnowledgeBases(session, "alpha").create(KnowledgeBaseIn(title="test"))
            wrote = False
            body = ThoughtNoteCreate(
                knowledge_base_id=knowledge.id,
                expected_knowledge_revision=knowledge.revision,
                document={
                    "type": "doc",
                    "content": [
                        {
                            "type": "attachment",
                            "attrs": {
                                "assetId": asset_id,
                                "filename": "untrusted",
                                "mimeType": "bad/type",
                                "byteSize": 0,
                            },
                        }
                    ],
                },
            )
            result = await Directory(session, "alpha").create_content(body)
            assert result.document["content"][0]["attrs"]["filename"] == "note.txt"
            assert network == 2 and wrote
    finally:
        await database.close()


async def test_expired_preflight_snapshot_never_refreshes_during_mutation():
    import time

    calls = 0
    row = LibraryAsset("a", "a.txt", "text/plain", "file", 1, 0)

    def handler(_request):
        nonlocal calls
        calls += 1
        raise AssertionError("A stale snapshot must not make another network request")

    port = HttpAssetMetadata(
        assertion="proof",
        source_method="POST",
        source_path="/v1/thought-workshop/notes",
        credential="service-secret",
        catalog=CATALOG,
        transport=httpx.MockTransport(handler),
    )
    port.snapshots["a"] = (row, time.monotonic() - 6)
    with pytest.raises(ThoughtError, match="已过期"):
        await port.describe({"a"})
    assert calls == 0
