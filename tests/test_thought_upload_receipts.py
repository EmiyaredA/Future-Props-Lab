"""Thought upload receipts use only isolated Assets storage and real file writes."""

import hashlib
import io

import pytest
from sqlalchemy import select
from starlette.datastructures import UploadFile

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_assets.migrations.registry import MIGRATIONS
from fpl_assets.models import MODELS, ThoughtUploadReceipt
from fpl_assets.settings import StorageSettings
from fpl_assets.thought_uploads import ThoughtUploads
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply
from fpl_runtime.thought_uploads import ThoughtUploadDescription

CONTENT = b"\x89PNG\r\n\x1a\nsynthetic image bytes"


@pytest.fixture
async def store(tmp_path):
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    db = Database("assets", tmp_path, models=MODELS)
    yield db, StorageSettings(tmp_path / "service.db")
    await db.close()


def description(content=CONTENT, *, kind="image", filename="image.png"):
    return ThoughtUploadDescription(
        kind, filename, "image/png", len(content), hashlib.sha256(content).hexdigest()
    )


def incoming(content=CONTENT):
    return UploadFile(io.BytesIO(content), filename="image.png")


async def active():
    return True


async def test_lost_commit_response_replays_same_receipt_without_duplicate_file(store, monkeypatch):
    db, settings = store
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        service = ThoughtUploads(session, settings, "alpha", active=active)
        commit = session.commit

        async def lost():
            await commit()
            raise RuntimeError("lost response")

        monkeypatch.setattr(session, "commit", lost)
        with pytest.raises(RuntimeError, match="lost response"):
            await service.store("one", description(), incoming())
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        service = ThoughtUploads(session, settings, "alpha", active=active)
        result = await service.store("one", description(), incoming())
        assert result.original_filename == "image.png"
        rows = list(await session.scalars(select(VisualAsset)))
        assert len(rows) == 1
        assert AssetStorage(settings).path_for(rows[0]).read_bytes() == CONTENT
        assert len(list(await session.scalars(select(ThoughtUploadReceipt)))) == 1
        with pytest.raises(AssetError) as conflict:
            await service.store("one", description(CONTENT + b"x"), incoming(CONTENT + b"x"))
        assert conflict.value.status == 409


async def test_digest_and_kind_mismatch_never_publish_receipt(store):
    db, settings = store
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        service = ThoughtUploads(session, settings, "alpha", active=active)
        with pytest.raises(AssetError):
            await service.store("wrong-hash", description(CONTENT + b"x"), incoming())
        with pytest.raises(AssetError):
            await service.store("wrong-kind", description(kind="attachment"), incoming())
        assert list(await session.scalars(select(ThoughtUploadReceipt))) == []
        assert list(await session.scalars(select(VisualAsset))) == []


async def test_private_upload_route_binds_owner_descriptor_and_request(store):
    from pathlib import Path

    import httpx
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from fpl_assets.application import create_app
    from fpl_runtime.claims import HEADER, Actor, issue_context
    from fpl_runtime.routing import RouteCatalog
    from fpl_runtime.thought_uploads import upload_path

    class Live:
        async def status(self, **_kwargs):
            return True

        async def close(self):
            pass

    db, settings = store
    await db.close()
    key = Ed25519PrivateKey.generate()
    root = Path(__file__).resolve().parents[1]
    app = create_app(
        settings=settings,
        catalog=RouteCatalog.read(root / "deploy/contracts/ownership.json"),
        public_key=key.public_key(),
        identity=Live(),
        capabilities=Live(),
        cleanup=False,
        thought_upload_result_key="u" * 48,
    )
    desc = description()
    path = upload_path("image", "one", desc.fingerprint)
    actor = Actor(
        "alpha", "user", "session", ("studio:private_read", "studio:write"), session_id="s"
    )
    token = issue_context(
        actor, service="assets", method="POST", path=path, private_key=key, key_id="test"
    )
    headers = {
        HEADER: token,
        "X-Fpl-Upload-Descriptor": desc.header(),
        "X-Fpl-Upload-Nonce": "a" * 32,
    }
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://assets"
        ) as c:
            bad = await c.post(
                path, headers={**headers, "Origin": "http://browser"}, content=CONTENT
            )
            assert bad.status_code == 403
            signer = app.state.thought_upload_results
            del app.state.thought_upload_results
            assert (await c.post(path, headers=headers, content=CONTENT)).status_code == 503
            app.state.thought_upload_results = signer
            no_nonce = {key: value for key, value in headers.items() if key != "X-Fpl-Upload-Nonce"}
            assert (await c.post(path, headers=no_nonce, content=CONTENT)).status_code == 422
            first = await c.post(path, headers=headers, content=CONTENT)
            assert first.status_code == 200, first.text
            replay = await c.post(path, headers=headers, content=CONTENT)
            assert replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
            assert (
                await c.post(
                    path.replace("/image/", "/attachment/"), headers=headers, content=CONTENT
                )
            ).status_code == 401
            assert (await c.post(path, headers=headers, content=CONTENT + b"x")).status_code == 422


def test_upload_delegation_matches_kind_caller_method_id_and_digest_exactly():
    from dataclasses import replace

    from fpl_runtime.delegation import RequestGrant
    from fpl_runtime.thought_assets import upload_grant
    from fpl_runtime.thought_uploads import upload_path

    desc = description()
    grant = RequestGrant(
        "thought",
        "thought.library.upload",
        "POST",
        "/v1/thought-workshop/images",
        "assets",
        "POST",
        upload_path("image", "one", desc.fingerprint),
    )
    assert upload_grant(grant)
    assert upload_grant(
        replace(
            grant,
            source_path="/v1/thought-workshop/attachments",
            target_path=upload_path("attachment", "one", desc.fingerprint),
        )
    )
    for denied in (
        replace(grant, caller="models"),
        replace(grant, purpose="thought.library.read"),
        replace(grant, source_method="PUT"),
        replace(grant, target_method="GET"),
        replace(grant, target_service="thought"),
        replace(grant, source_path="/v1/thought-workshop/attachments"),
        replace(grant, source_path="/v1/thought-workshop/community/publications/pub/uploads"),
        replace(grant, target_path=grant.target_path + "/extra"),
        replace(grant, target_path=grant.target_path.replace("/one/", "/../")),
        replace(grant, target_path=grant.target_path.upper()),
    ):
        assert not upload_grant(denied)


async def test_thought_staging_preserves_bytes_until_confirmed_receipt(tmp_path, monkeypatch):
    from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
    from fpl_thought.models import ACCOUNT_MODELS
    from fpl_thought.models import MODELS as THOUGHT_MODELS
    from fpl_thought.upload_intents import confirm_upload, stage_path, stage_upload
    from fpl_thought.upload_records import ThoughtUploadIntent

    apply(tmp_path / "service.db", "thought", THOUGHT_MIGRATIONS)
    db = Database("thought", tmp_path, models=THOUGHT_MODELS, account_models=ACCOUNT_MODELS)
    desc = description()
    path = stage_path(tmp_path, "alpha", "one", desc.fingerprint)
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        result = await stage_upload(
            session,
            root=tmp_path,
            owner="alpha",
            request_id="one",
            description=desc,
            incoming=incoming(),
        )
        assert result.state == "staged" and path.read_bytes() == CONTENT
        assert path.stat().st_mode & 0o777 == 0o600
    async with db.sessions(info={"owner_user_id": "beta"}) as session:
        assert await session.get(ThoughtUploadIntent, ("alpha", "one")) is None
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        real_commit = session.commit

        async def lost():
            await real_commit()
            raise RuntimeError("lost confirmation")

        monkeypatch.setattr(session, "commit", lost)
        with pytest.raises(RuntimeError, match="lost confirmation"):
            await confirm_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                asset_id="asset",
            )
        assert path.read_bytes() == CONTENT
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ThoughtUploadIntent, ("alpha", "one"))
        assert row.state == "confirmed" and row.result == {"asset_id": "asset"}
        await session.rollback()
        await confirm_upload(
            session,
            root=tmp_path,
            owner="alpha",
            request_id="one",
            description=desc,
            asset_id="asset",
        )
        assert not path.exists()
    await db.close()


async def test_failed_staging_does_not_publish_intent_or_keep_partial_bytes(tmp_path):
    from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
    from fpl_thought.models import ACCOUNT_MODELS
    from fpl_thought.models import MODELS as THOUGHT_MODELS
    from fpl_thought.upload_intents import stage_path, stage_upload
    from fpl_thought.upload_records import ThoughtUploadIntent

    apply(tmp_path / "service.db", "thought", THOUGHT_MIGRATIONS)
    db = Database("thought", tmp_path, models=THOUGHT_MODELS, account_models=ACCOUNT_MODELS)
    desc = description(CONTENT + b"x")
    path = stage_path(tmp_path, "alpha", "one", desc.fingerprint)
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(Exception, match="摘要或长度"):
            await stage_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                incoming=incoming(),
            )
        assert not path.exists()
        assert await session.get(ThoughtUploadIntent, ("alpha", "one")) is None
    await db.close()


async def test_staged_transport_delegates_exact_upload_and_preserves_unknown_result(
    tmp_path, monkeypatch
):
    import httpx

    from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
    from fpl_runtime.routing import RouteCatalog
    from fpl_runtime.thought_uploads import upload_path
    from fpl_thought.upload_transport import send_staged_upload

    desc = description()
    staged = tmp_path / "staged"
    staged.write_bytes(CONTENT)
    calls = []
    failure = False
    signature_mode = "valid"
    monkeypatch.setattr("fpl_thought.upload_transport.secrets.token_hex", lambda _n: "b" * 32)
    target = upload_path("image", "one", desc.fingerprint)

    async def handle(request):
        calls.append(request)
        if request.url.host == "identity":
            import json

            grant = json.loads(request.content)
            assert grant["source_path"] == "/v1/thought-workshop/images"
            assert grant["target_path"] == target
            assert grant["assertion"] == "signed-source"
            return httpx.Response(200, json={"assertion": "delegated"})
        assert request.url.path == target
        assert request.headers["x-fpl-context"] == "delegated"
        assert "cookie" not in request.headers and "authorization" not in request.headers
        assert await request.aread() == CONTENT
        if failure:
            raise httpx.ReadTimeout("lost response", request=request)
        response = httpx.Response(
            200,
            json={
                "id": "asset",
                "project_id": None,
                "folder_id": None,
                "original_filename": "image.png",
                "display_name": "image.png",
                "media_kind": "image",
                "mime_type": "image/png",
                "byte_size": len(CONTENT),
                "revision": 0,
                "created_at": "2026-01-01",
                "updated_at": "2026-01-01",
                "source": "library",
                "is_reference": False,
                "reference_id": None,
            },
        )
        from fpl_runtime.thought_uploads import ThoughtUploadReceiptAuthenticator

        if signature_mode != "missing":
            response.headers["X-Fpl-Upload-Receipt"] = ThoughtUploadReceiptAuthenticator(
                "u" * 48
            ).sign(
                owner="alpha",
                request_id="one",
                fingerprint=desc.fingerprint,
                nonce=(
                    "a" * 32 if signature_mode == "stale" else request.headers["x-fpl-upload-nonce"]
                ),
                body=response.content,
            )
        return response

    options = dict(
        path=staged,
        description=desc,
        request_id="one",
        owner="alpha",
        assertion="signed-source",
        source_path="/v1/thought-workshop/images",
        credential="c" * 48,
        receipt_credential="u" * 48,
        catalog=RouteCatalog.read(
            __import__("pathlib").Path(__file__).resolve().parents[1]
            / "deploy/contracts/ownership.json"
        ),
        transport=httpx.MockTransport(handle),
    )
    receipt = await send_staged_upload(**options)
    assert receipt.id == "asset"
    assert len(calls) == 2 and staged.read_bytes() == CONTENT
    signature_mode = "missing"
    with pytest.raises(CapabilityUnavailable):
        await send_staged_upload(**options)
    assert staged.read_bytes() == CONTENT
    signature_mode = "stale"
    with pytest.raises(CapabilityUnavailable):
        await send_staged_upload(**options)
    assert staged.read_bytes() == CONTENT
    signature_mode = "valid"
    with pytest.raises(CapabilityUnavailable):
        await send_staged_upload(**{**options, "owner": "beta"})
    assert staged.read_bytes() == CONTENT
    failure = True
    with pytest.raises(CapabilityUnavailable):
        await send_staged_upload(**options)
    assert len(calls) == 10 and staged.read_bytes() == CONTENT
    with pytest.raises(CapabilityDenied):
        await send_staged_upload(**{**options, "source_path": "/v1/thought-workshop/attachments"})
    assert len(calls) == 10


async def test_delivery_timeout_keeps_intent_and_source_for_exact_replay(tmp_path, monkeypatch):
    from fpl_runtime.capability_client import CapabilityUnavailable
    from fpl_thought import upload_transport
    from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
    from fpl_thought.models import ACCOUNT_MODELS
    from fpl_thought.models import MODELS as THOUGHT_MODELS
    from fpl_thought.upload_intents import deliver_staged_upload, stage_path, stage_upload
    from fpl_thought.upload_records import ThoughtUploadIntent

    async def timeout(**_kwargs):
        raise CapabilityUnavailable("response lost")

    monkeypatch.setattr(upload_transport, "send_staged_upload", timeout)
    apply(tmp_path / "service.db", "thought", THOUGHT_MIGRATIONS)
    db = Database("thought", tmp_path, models=THOUGHT_MODELS, account_models=ACCOUNT_MODELS)
    desc = description()
    try:
        async with db.sessions(info={"owner_user_id": "alpha"}) as session:
            await stage_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                incoming=incoming(),
            )
            with pytest.raises(CapabilityUnavailable):
                await deliver_staged_upload(
                    session,
                    root=tmp_path,
                    owner="alpha",
                    request_id="one",
                    description=desc,
                    assertion="source",
                    source_path="/v1/thought-workshop/images",
                    credential="test",
                    receipt_credential="u" * 48,
                    catalog=None,
                )
            row = await session.get(ThoughtUploadIntent, ("alpha", "one"))
            assert row.state == "staged" and row.result is None
            assert stage_path(tmp_path, "alpha", "one", desc.fingerprint).read_bytes() == CONTENT
    finally:
        await db.close()


async def test_restart_recovers_only_confirmed_and_provably_uncommitted_staging(tmp_path):
    from dataclasses import asdict

    from fpl_runtime.locking import service_lock
    from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
    from fpl_thought.models import ACCOUNT_MODELS
    from fpl_thought.models import MODELS as THOUGHT_MODELS
    from fpl_thought.upload_intents import stage_path
    from fpl_thought.upload_records import ThoughtUploadIntent
    from fpl_thought.upload_recovery import recover_upload_staging

    apply(tmp_path / "service.db", "thought", THOUGHT_MIGRATIONS)
    db = Database("thought", tmp_path, models=THOUGHT_MODELS, account_models=ACCOUNT_MODELS)
    desc = description()
    files = {}
    try:
        for request_id in ("confirmed", "staged", "orphan", "unknown"):
            path = stage_path(tmp_path, "alpha", request_id, desc.fingerprint)
            path.write_bytes(CONTENT)
            files[request_id] = path
        async with db.sessions(info={"owner_user_id": "alpha"}) as session:
            for request_id, state, result in (
                ("confirmed", "confirmed", {"asset_id": "asset"}),
                ("staged", "staged", None),
                ("unknown", "unexpected", None),
            ):
                session.add(
                    ThoughtUploadIntent(
                        owner_user_id="alpha",
                        request_id=request_id,
                        descriptor_sha256=desc.fingerprint,
                        descriptor=asdict(desc),
                        state=state,
                        result=result,
                    )
                )
            await session.commit()
        outsider = tmp_path / "outside"
        outsider.mkdir()
        (outsider / "orphan.upload").write_bytes(b"outside")
        (tmp_path / "upload-staging" / "beta").symlink_to(outsider, target_is_directory=True)
        (tmp_path / "upload-staging" / "alpha" / "link.upload").symlink_to(
            outsider / "orphan.upload"
        )
        with service_lock(tmp_path):
            await recover_upload_staging(tmp_path, db.sessions)
            await recover_upload_staging(tmp_path, db.sessions)
        assert not files["confirmed"].exists() and not files["orphan"].exists()
        assert files["staged"].read_bytes() == files["unknown"].read_bytes() == CONTENT
        assert (outsider / "orphan.upload").read_bytes() == b"outside"
        assert (tmp_path / "upload-staging" / "alpha" / "link.upload").is_symlink()
    finally:
        await db.close()


def test_upload_receipt_signature_binds_response_and_exact_request():
    from fpl_runtime.thought_uploads import ThoughtUploadReceiptAuthenticator

    signer = ThoughtUploadReceiptAuthenticator("u" * 48)
    binding = dict(
        owner="alpha",
        request_id="one",
        fingerprint="a" * 64,
        nonce="b" * 32,
        body=b'{"id":"asset"}',
    )
    signature = signer.sign(**binding)
    signer.verify(signature, **binding)
    for changed in (
        {"owner": "beta"},
        {"request_id": "other"},
        {"fingerprint": "c" * 64},
        {"nonce": "d" * 32},
        {"body": b'{"id":"other"}'},
    ):
        with pytest.raises(ValueError):
            signer.verify(signature, **(binding | changed))


async def test_confirmed_upload_metadata_is_replayable_and_legacy_receipts_enrich_safely(tmp_path):
    from app.apps.thought_workshop.errors import ThoughtError
    from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
    from fpl_thought.models import ACCOUNT_MODELS
    from fpl_thought.models import MODELS as THOUGHT_MODELS
    from fpl_thought.upload_intents import confirm_upload, stage_upload
    from fpl_thought.upload_records import ThoughtUploadIntent

    apply(tmp_path / "service.db", "thought", THOUGHT_MIGRATIONS)
    db = Database("thought", tmp_path, models=THOUGHT_MODELS, account_models=ACCOUNT_MODELS)
    desc = description()
    metadata = {"filename": "image.png", "mime_type": "image/png", "byte_size": len(CONTENT)}
    try:
        async with db.sessions(info={"owner_user_id": "alpha"}) as session:
            await stage_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                incoming=incoming(),
            )
            await confirm_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                asset_id="asset",
            )
        async with db.sessions(info={"owner_user_id": "alpha"}) as session:
            await confirm_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                asset_id="asset",
                receipt=metadata,
            )
            row = await session.get(ThoughtUploadIntent, ("alpha", "one"))
            assert row.result == {"asset_id": "asset", **metadata}
            await session.rollback()
            await confirm_upload(
                session,
                root=tmp_path,
                owner="alpha",
                request_id="one",
                description=desc,
                asset_id="asset",
                receipt=metadata,
            )
            with pytest.raises(ThoughtError, match="回执不一致"):
                await confirm_upload(
                    session,
                    root=tmp_path,
                    owner="alpha",
                    request_id="one",
                    description=desc,
                    asset_id="asset",
                    receipt={**metadata, "mime_type": "image/jpeg"},
                )
    finally:
        await db.close()
