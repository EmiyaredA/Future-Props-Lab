"""Real Identity, Assets and Thought evidence over isolated in-process HTTP."""

import io
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import delete, update
from starlette.datastructures import UploadFile

from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.apps.thought_workshop.publication.models import (
    ArticleMember,
    Publication,
    PublishedArticle,
)
from app.capabilities.asset_store.library import AssetLibrary
from fpl_assets.application import create_app as create_assets
from fpl_assets.community_assets import CommunityAssetChecks
from fpl_assets.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from fpl_assets.settings import StorageSettings
from fpl_identity.accounts import create_account
from fpl_identity.application import create_app as create_identity
from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from fpl_runtime.claims import HEADER
from fpl_runtime.database import Database
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_thought.community_access import published_asset
from fpl_thought.community_evidence import CommunityEvidenceVerifier
from fpl_thought.community_evidence import router as evidence_router
from fpl_thought.migrations.registry import MIGRATIONS as THOUGHT_MIGRATIONS
from fpl_thought.models import ACCOUNT_MODELS, MODELS

ROOT = Path(__file__).resolve().parents[1]
CATALOG = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
THOUGHT_SECRET = "thought-service-test-credential-00000000000000"
ASSETS_SECRET = "assets-service-test-credential-000000000000000"
PEER_SECRET = "assets-thought-peer-test-credential-000000000"
GATEWAY_SECRET = "gateway-test-credential-0000000000000000000000"
PASSWORD = "Synthetic-community-password-2026!"


class Directory:
    def for_session(self, _session):
        return self

    async def current(self, principal):
        return principal


class Noop:
    async def close(self):
        pass


class Mesh(httpx.AsyncBaseTransport):
    def __init__(self):
        self.apps = {}

    async def handle_async_request(self, request):
        assert not request.headers.get("cookie")
        return await httpx.ASGITransport(app=self.apps[request.url.host]).handle_async_request(
            request
        )


@pytest.fixture
async def scenario(tmp_path, monkeypatch):
    key = Ed25519PrivateKey.generate()
    roots = {name: tmp_path / name for name in ("identity", "assets", "thought")}
    for root in roots.values():
        root.mkdir()
    apply(roots["identity"] / "service.db", "identity", IDENTITY_MIGRATIONS)
    apply(roots["assets"] / "service.db", "assets", ASSET_MIGRATIONS)
    apply(roots["thought"] / "service.db", "thought", THOUGHT_MIGRATIONS)
    from app.runtime.config import get_settings

    monkeypatch.setenv("FPL_DATABASE_PATH", str(roots["identity"] / "service.db"))
    get_settings.cache_clear()
    identity = create_identity(
        state_root=roots["identity"],
        catalog=CATALOG,
        gateway_token=GATEWAY_SECRET,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        private_key=key,
        service_credentials={"thought": THOUGHT_SECRET, "assets": ASSETS_SECRET},
    )
    thought_db = Database("thought", roots["thought"], models=MODELS, account_models=ACCOUNT_MODELS)
    mesh = Mesh()
    live = LiveAuthorization(service="thought", credential=THOUGHT_SECRET, transport=mesh)
    thought = FastAPI()
    thought.state.assets_community_peer_token = PEER_SECRET
    thought.state.community_evidence = CommunityEvidenceVerifier(
        thought_db,
        public_key=key.public_key(),
        identity=live,
        directory_factory=lambda _principal, _source: Directory(),
    )
    thought.include_router(evidence_router)
    checks = CommunityAssetChecks(
        identity_credential=ASSETS_SECRET, thought_credential=PEER_SECRET, transport=mesh
    )
    settings = StorageSettings(roots["assets"] / "service.db")
    assets = create_assets(
        settings=settings,
        catalog=CATALOG,
        public_key=key.public_key(),
        identity=Noop(),
        capabilities=Noop(),
        cleanup=False,
        community_asset_checks=checks,
    )
    mesh.apps.update(identity=identity, assets=assets, thought=thought)
    async with identity.router.lifespan_context(identity), assets.router.lifespan_context(assets):
        async with identity.state.database.sessions() as session:
            owner, _ = await create_account(
                session,
                username="source-owner",
                display_name="Source",
                password=PASSWORD,
                platform_role="user",
            )
            viewer, _ = await create_account(
                session,
                username="viewing-user",
                display_name="Viewer",
                password=PASSWORD,
                platform_role="user",
            )
            owner_id, viewer_id = owner.id, viewer.id
        async with assets.state.database.sessions(info={"owner_user_id": owner_id}) as session:
            asset = await AssetLibrary(session, settings).store_upload(
                UploadFile(
                    io.BytesIO(b"\x89PNG\r\n\x1a\nvisible image bytes"), filename="cover.png"
                ),
                owner_user_id=owner_id,
            )
            asset_id = asset.id
        async with thought_db.sessions(info={"owner_user_id": owner_id}) as session:
            session.add(ThoughtKnowledgeBase(id="book", owner_user_id=owner_id, title="Book"))
            await session.flush()
            session.add(
                ThoughtNote(
                    id="note",
                    owner_user_id=owner_id,
                    knowledge_base_id="book",
                    title="Published",
                    kind="note",
                    document={
                        "type": "doc",
                        "content": [{"type": "image", "attrs": {"assetId": asset_id}}],
                    },
                    search_text="",
                )
            )
            await session.flush()
            session.add(
                Publication(
                    id="pub",
                    owner_user_id=owner_id,
                    knowledge_base_id="book",
                    publisher_id=owner_id,
                    title="Publication",
                    cover_asset_id=asset_id,
                )
            )
            await session.flush()
            session.add(
                PublishedArticle(publication_id="pub", note_id="note", visibility="private")
            )
            session.add(
                ArticleMember(publication_id="pub", note_id="note", user_id=viewer_id, role="read")
            )
            await session.commit()
        headers = {
            "X-Fpl-Gateway": GATEWAY_SECRET,
            "X-Fpl-Ingress": "local",
            "X-Fpl-Client-Ip": "127.0.0.1",
        }
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=identity),
            base_url="http://127.0.0.1:19000",
            headers=headers,
        ) as browser:
            login = await browser.post(
                "/v1/auth/login", json={"username": "viewing-user", "password": PASSWORD}
            )
            assert login.status_code == 200, login.text
            csrf = browser.cookies["fpl_csrf"]
            yield SimpleNamespace(
                key=key,
                identity=identity,
                assets=assets,
                thought=thought,
                db=thought_db,
                mesh=mesh,
                browser=browser,
                csrf=csrf,
                owner=owner_id,
                viewer=viewer_id,
                asset=asset_id,
            )
    await live.close()
    await thought_db.close()
    get_settings.cache_clear()


from types import SimpleNamespace  # noqa: E402


async def grant(case, *, cover=False, note_id="note"):
    path = (
        "/v1/thought-workshop/community/publications/pub/cover"
        if cover
        else f"/v1/thought-workshop/community/publications/pub/assets/{case.asset}/content"
    )
    response = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": "GET",
            "X-Fpl-Request-Uri": path,
        },
    )
    assert response.status_code == 204, response.text
    assertion = response.headers[HEADER]
    async with case.db.sessions(
        info={"allow_system_reads": True, "thought_directory": Directory()}
    ) as session:
        evidence = await published_asset(
            session,
            SimpleNamespace(user_id=case.viewer, platform_role="user", auth_kind="session"),
            "pub",
            case.asset,
            note_id=None if cover else note_id,
            cover=cover,
        )
    async with httpx.AsyncClient(transport=case.mesh) as private:
        response = await private.post(
            "http://identity/_internal/v1/thought-community-assets/authorize",
            headers={"Authorization": "Bearer " + THOUGHT_SECRET},
            json={
                "source_assertion": assertion,
                "source_method": "GET",
                "source_path": path,
                "evidence": asdict(evidence),
            },
        )
        assert response.status_code == 200, response.text
        return response.json()["authority"]


async def read(case, token, **headers):
    async with httpx.AsyncClient(transport=case.mesh) as client:
        return await client.get(
            "http://assets/_internal/v1/thought-community-assets/content",
            headers={"Authorization": "Bearer " + token, **headers},
        )


async def test_cross_account_content_rechecks_identity_and_source_on_every_read(scenario):
    case = scenario
    token = await grant(case)
    first = await read(case, token)
    assert first.status_code == 200 and first.content == b"\x89PNG\r\n\x1a\nvisible image bytes"
    assert first.headers["cache-control"] == "no-store"
    assert (await read(case, token, Origin="http://browser")).status_code == 403
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(
            update(ThoughtNote)
            .where(ThoughtNote.id == "note")
            .values(document={"type": "doc", "content": []}, revision=1)
        )
        await session.commit()
    assert (await read(case, token)).status_code == 404


async def test_membership_or_session_revocation_invalidates_existing_proof(scenario):
    case = scenario
    token = await grant(case)
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(delete(ArticleMember).where(ArticleMember.user_id == case.viewer))
        await session.commit()
    assert (await read(case, token)).status_code == 404
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        session.add(
            ArticleMember(publication_id="pub", note_id="note", user_id=case.viewer, role="read")
        )
        await session.commit()
    token = await grant(case)
    logout = await case.browser.post(
        "/v1/auth/logout", headers={"X-CSRF-Token": case.csrf, "Origin": "http://127.0.0.1:19000"}
    )
    assert logout.status_code == 204
    assert (await read(case, token)).status_code == 404


async def test_wrong_owner_or_stale_evidence_cannot_become_a_file_read(scenario):
    from fpl_runtime.community_assets import verify_community_asset

    case = scenario
    token = await grant(case)
    _actor, request = verify_community_asset(token, public_key=case.key.public_key())
    for changed in (
        {"source_owner_id": case.viewer},
        {"note_id": "another-note"},
        {"note_revision": request.evidence.note_revision + 1},
        {"publication_revision": request.evidence.publication_revision + 1},
    ):
        body = request.model_dump(mode="json")
        body["evidence"] = {**body["evidence"], **changed}
        async with httpx.AsyncClient(transport=case.mesh) as private:
            response = await private.post(
                "http://identity/_internal/v1/thought-community-assets/authorize",
                headers={"Authorization": "Bearer " + THOUGHT_SECRET},
                json=body,
            )
            assert response.status_code == 200, response.text
        denied = await read(case, response.json()["authority"])
        assert denied.status_code == 404


async def test_private_evidence_endpoint_requires_dedicated_nonbrowser_peer(scenario):
    case = scenario
    token = await grant(case)
    async with httpx.AsyncClient(transport=case.mesh) as private:
        path = "http://thought/_internal/v1/community-evidence/verify"
        assert (await private.post(path, json={"authority": token})).status_code == 403
        assert (
            await private.post(
                path,
                headers={"Authorization": "Bearer " + PEER_SECRET, "Origin": "http://browser"},
                json={"authority": token},
            )
        ).status_code == 403
        assert (
            await private.post(
                path,
                headers={"Authorization": "Bearer " + ASSETS_SECRET},
                json={"authority": token},
            )
        ).status_code == 403
        valid = await private.post(
            path, headers={"Authorization": "Bearer " + PEER_SECRET}, json={"authority": token}
        )
        assert valid.status_code == 200 and valid.json() == {"valid": True}


async def test_identity_grant_binds_browser_viewer_and_public_asset_path(scenario):
    from fpl_runtime.community_assets import verify_community_asset

    case = scenario
    token = await grant(case)
    _actor, request = verify_community_asset(token, public_key=case.key.public_key())
    body = request.model_dump(mode="json")
    async with httpx.AsyncClient(transport=case.mesh) as private:
        path = "http://identity/_internal/v1/thought-community-assets/authorize"
        forged = {**body, "evidence": {**body["evidence"], "viewer_id": case.owner}}
        response = await private.post(
            path, headers={"Authorization": "Bearer " + THOUGHT_SECRET}, json=forged
        )
        assert response.status_code == 403
        forged = {**body, "evidence": {**body["evidence"], "asset_id": "another"}}
        response = await private.post(
            path, headers={"Authorization": "Bearer " + THOUGHT_SECRET}, json=forged
        )
        assert response.status_code == 403
        response = await private.post(
            path, headers={"Authorization": "Bearer " + ASSETS_SECRET}, json=body
        )
        assert response.status_code == 403
        changed = {**body, "source_path": body["source_path"].replace("/pub/", "/other/")}
        response = await private.post(
            path, headers={"Authorization": "Bearer " + THOUGHT_SECRET}, json=changed
        )
        assert response.status_code == 403


async def test_withdrawn_publication_and_missing_checks_fail_closed(scenario):
    case = scenario
    token = await grant(case)
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(
            update(Publication).where(Publication.id == "pub").values(active=False)
        )
        await session.commit()
    assert (await read(case, token)).status_code == 404
    checks = case.assets.state.community_asset_checks
    case.assets.state.community_asset_checks = None
    try:
        assert (await read(case, token)).status_code == 503
    finally:
        case.assets.state.community_asset_checks = checks


def test_community_capability_has_strict_five_second_lifetime():
    import jwt

    from fpl_runtime.claims import Actor, issue_context
    from fpl_runtime.community_assets import (
        CommunityAssetEvidence,
        CommunityAssetRequest,
        issue_community_asset,
        verify_community_asset,
    )

    key = Ed25519PrivateKey.generate()
    actor = Actor("viewer", "user", "session", ("studio:read",), session_id="session")
    path = "/v1/thought-workshop/community/publications/pub/assets/file/content"
    source = issue_context(
        actor, service="thought", method="GET", path=path, private_key=key, key_id="test"
    )
    body = CommunityAssetRequest(
        source_assertion=source,
        source_method="GET",
        source_path=path,
        evidence=CommunityAssetEvidence(
            viewer_id="viewer",
            source_owner_id="owner",
            publication_id="pub",
            publication_revision=1,
            asset_id="file",
            note_id="note",
            note_revision=1,
            article_revision=1,
            cover=False,
        ),
    )
    expired = issue_community_asset(actor, body, private_key=key, key_id="test", now=100)
    with pytest.raises(jwt.ExpiredSignatureError):
        verify_community_asset(expired, public_key=key.public_key())


async def test_published_cover_reads_only_while_still_current(scenario):
    case = scenario
    token = await grant(case, cover=True)
    response = await read(case, token)
    assert response.status_code == 200 and response.content.startswith(b"\x89PNG")
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(
            update(Publication)
            .where(Publication.id == "pub")
            .values(cover_asset_id=None, revision=1)
        )
        await session.commit()
    assert (await read(case, token)).status_code == 404


async def test_public_asset_url_without_note_id_resolves_current_multitable_attachment(scenario):
    from app.apps.thought_workshop.multitable.models import (
        DataAsset,
        DataField,
        DataRecord,
        DataTable,
        DataView,
    )

    case = scenario
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(
            update(ThoughtNote)
            .where(ThoughtNote.id == "note")
            .values(
                kind="multitable",
                document={"type": "doc", "content": []},
                revision=1,
            )
        )
        session.add(DataTable(id="table", note_id="note", name="Table", position=0))
        await session.flush()
        session.add(
            DataField(
                id="field", table_id="table", name="Attachments", type="attachment", position=0
            )
        )
        session.add(DataView(id="view", table_id="table", name="Grid", type="grid", position=0))
        session.add(
            DataRecord(id="record", table_id="table", position=0, values={"field": [case.asset]})
        )
        session.add(DataAsset(note_id="note", asset_id=case.asset))
        await session.commit()
    token = await grant(case, note_id=None)
    result = await read(case, token)
    assert result.status_code == 200 and result.content.startswith(b"\x89PNG")
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        await session.execute(
            update(DataRecord).where(DataRecord.id == "record").values(values={"field": []})
        )
        await session.execute(
            update(ThoughtNote).where(ThoughtNote.id == "note").values(revision=2)
        )
        await session.commit()
    assert (await read(case, token)).status_code == 404
