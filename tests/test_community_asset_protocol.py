"""Real Identity, Assets and Thought evidence over isolated in-process HTTP."""

import io
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import delete, select, update
from starlette.datastructures import UploadFile

from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.apps.thought_workshop.publication.models import (
    ArticleMember,
    Publication,
    PublishedArticle,
)
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
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
        thought_upload_result_key="u" * 48,
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


async def test_browser_route_streams_through_three_services_and_rechecks_revocation(scenario):
    from app.apps.thought_workshop.account_directory import DirectoryBindings
    from fpl_runtime.authentication import SignedIdentity
    from fpl_thought.account_directory import HttpAccountDirectory
    from fpl_thought.community_http import CommunityFiles, router

    case = scenario
    app = FastAPI()
    app.state.database = case.db
    app.state.community_files = CommunityFiles(
        credential=THOUGHT_SECRET, public_key=case.key.public_key(), transport=case.mesh
    )

    def directory_for(principal, assertion, method, path):
        return HttpAccountDirectory(
            principal=principal,
            assertion=assertion,
            source_method=method,
            source_path=path,
            credential=THOUGHT_SECRET,
            catalog=CATALOG,
            transport=case.mesh,
        )

    app.state.thought_directory = DirectoryBindings(
        lambda request, _session, principal: directory_for(
            principal, request.state.service_assertion, request.method, request.url.path
        )
    )
    case.thought.state.community_evidence.directory_factory = lambda principal, source: (
        directory_for(principal, source.source_assertion, source.source_method, source.source_path)
    )
    app.include_router(router, prefix="/v1")
    app.add_middleware(
        SignedIdentity, service="thought", public_key=case.key.public_key(), catalog=CATALOG
    )
    path = f"/v1/thought-workshop/community/publications/pub/assets/{case.asset}/content"
    authorized = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": "GET",
            "X-Fpl-Request-Uri": path,
        },
    )
    assert authorized.status_code == 204
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://thought"
    ) as browser:
        response = await browser.get(path, headers={HEADER: authorized.headers[HEADER]})
        assert response.status_code == 200, response.text
        assert response.content == b"\x89PNG\r\n\x1a\nvisible image bytes"
        assert response.headers["cache-control"] == "no-store"
        async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
            await session.execute(delete(ArticleMember).where(ArticleMember.user_id == case.viewer))
            await session.commit()
        assert (
            await browser.get(path, headers={HEADER: authorized.headers[HEADER]})
        ).status_code == 404
    await app.state.community_files.close()


async def test_note_batch_http_with_real_identity_and_assets_retention(scenario):
    from fpl_assets.references import AssetReferences
    from fpl_runtime.asset_references import ReferenceUpdate
    from fpl_runtime.retention_client import RetentionClient
    from fpl_thought.application import create_app as create_thought
    from fpl_thought.retention import ThoughtReferenceDelivery
    from fpl_thought.retention_records import ThoughtReferenceMutation

    case = scenario
    await AssetReferences(case.assets.state.database).replace(
        owner=case.owner,
        service="thought",
        update=ReferenceUpdate(
            request_id="initial-projection",
            resource_kind="note",
            resource_id="note",
            resource_revision=0,
            expected_revision=0,
            asset_ids=[case.asset],
        ),
    )
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    client = RetentionClient(service="thought", credential=THOUGHT_SECRET, transport=case.mesh)
    app = create_thought(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=client,
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )
    path = "/v1/thought-workshop/notes/note/operations"
    headers = {
        "X-Fpl-Gateway": GATEWAY_SECRET,
        "X-Fpl-Ingress": "local",
        "X-Fpl-Client-Ip": "127.0.0.1",
    }
    async with app.router.lifespan_context(app):
        async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
            session.add(
                ThoughtNote(
                    id="table",
                    owner_user_id=case.owner,
                    knowledge_base_id="book",
                    title="Table",
                    kind="multitable",
                    document={"type": "doc", "content": []},
                    search_text="",
                )
            )
            await session.flush()
            session.add(
                PublishedArticle(publication_id="pub", note_id="table", visibility="private")
            )
            session.add(
                ArticleMember(
                    publication_id="pub", note_id="table", user_id=case.viewer, role="read"
                )
            )
            await session.commit()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.identity),
            base_url="http://127.0.0.1:19000",
            headers=headers,
        ) as owner:
            login = await owner.post(
                "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
            )
            assert login.status_code == 200
            auth = await owner.get(
                "/_internal/v1/authorize",
                headers={
                    "X-Fpl-Target-Service": "thought",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": path,
                    "X-CSRF-Token": owner.cookies["fpl_csrf"],
                    "Origin": "http://127.0.0.1:19000",
                },
            )
            assert auth.status_code == 204
            read_path = "/v1/thought-workshop/notes/note"
            read_headers = {
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": read_path,
            }
            owner_read = await owner.get("/_internal/v1/authorize", headers=read_headers)
            viewer_read = await case.browser.get("/_internal/v1/authorize", headers=read_headers)
            assert owner_read.status_code == viewer_read.status_code == 204
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://thought"
            ) as reader:
                assert (
                    await reader.get(read_path, headers={HEADER: owner_read.headers[HEADER]})
                ).status_code == 200
                assert (
                    await reader.get(read_path, headers={HEADER: viewer_read.headers[HEADER]})
                ).status_code == 404
                table_path = "/v1/thought-workshop/notes/table/multitable"
                table_headers = {
                    "X-Fpl-Target-Service": "thought",
                    "X-Fpl-Request-Method": "GET",
                    "X-Fpl-Request-Uri": table_path,
                }
                table_owner = await owner.get("/_internal/v1/authorize", headers=table_headers)
                table_viewer = await case.browser.get(
                    "/_internal/v1/authorize", headers=table_headers
                )
                assert table_owner.status_code == table_viewer.status_code == 204
                assert (
                    await reader.get(table_path, headers={HEADER: table_owner.headers[HEADER]})
                ).status_code == 200
                assert (
                    await reader.get(table_path, headers={HEADER: table_viewer.headers[HEADER]})
                ).status_code == 404
                await AssetReferences(case.assets.state.database).replace(
                    owner=case.owner,
                    service="thought",
                    update=ReferenceUpdate(
                        request_id="table-initial",
                        resource_kind="note",
                        resource_id="table",
                        resource_revision=0,
                        expected_revision=0,
                        asset_ids=[],
                    ),
                )
                table_mutation_path = table_path + "/operations"
                table_auth = await owner.get(
                    "/_internal/v1/authorize",
                    headers={
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": "POST",
                        "X-Fpl-Request-Uri": table_mutation_path,
                        "X-CSRF-Token": owner.cookies["fpl_csrf"],
                        "Origin": "http://127.0.0.1:19000",
                    },
                )
                assert table_auth.status_code == 204
                table_body = {
                    "expected_revision": 0,
                    "operations": [
                        {
                            "op": "table.put",
                            "table": {
                                "id": "t",
                                "name": "Table",
                                "position": 0,
                                "fields": [
                                    {"id": "name", "name": "Name", "type": "text", "position": 0},
                                    {
                                        "id": "f",
                                        "name": "File",
                                        "type": "attachment",
                                        "position": 1,
                                    },
                                ],
                                "views": [{"id": "v", "name": "Grid", "position": 0}],
                            },
                        },
                        {
                            "op": "records.put",
                            "table_id": "t",
                            "records": [{"id": "r", "position": 0, "values": {"f": [case.asset]}}],
                        },
                    ],
                }
                table_write = await reader.post(
                    table_mutation_path,
                    headers={HEADER: table_auth.headers[HEADER]},
                    json=table_body,
                )
                assert table_write.status_code == 200, table_write.text
                assert table_write.json()["structure"]["revision"] == 1
                community_table_path = (
                    "/v1/thought-workshop/community/publications/pub/notes/table/multitable"
                )
                community_table_auth = await case.browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": "GET",
                        "X-Fpl-Request-Uri": community_table_path,
                    },
                )
                assert community_table_auth.status_code == 204
                community_table = await reader.get(
                    community_table_path, headers={HEADER: community_table_auth.headers[HEADER]}
                )
                assert community_table.status_code == 200, community_table.text
                assert community_table.json()["role"] == "read"
                community_path = "/v1/thought-workshop/community/publications/pub/notes/note"
                community_auth = await case.browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": "GET",
                        "X-Fpl-Request-Uri": community_path,
                    },
                )
                assert community_auth.status_code == 204
                community = await reader.get(
                    community_path, headers={HEADER: community_auth.headers[HEADER]}
                )
                assert community.status_code == 200, community.text
                asset_path = (
                    f"/v1/thought-workshop/community/publications/pub/assets/{case.asset}/content"
                )
                asset_auth = await case.browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": "GET",
                        "X-Fpl-Request-Uri": asset_path,
                    },
                )
                assert asset_auth.status_code == 204
                case.mesh.apps["thought"] = app
                asset = await reader.get(asset_path, headers={HEADER: asset_auth.headers[HEADER]})
                assert asset.status_code == 200, asset.text
                assert asset.content == b"\x89PNG\r\n\x1a\nvisible image bytes"
                async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
                    await session.execute(
                        delete(ArticleMember).where(ArticleMember.user_id == case.viewer)
                    )
                    await session.commit()
                assert (
                    await reader.get(asset_path, headers={HEADER: asset_auth.headers[HEADER]})
                ).status_code == 404
            request = {
                "expected_revision": 0,
                "request_id": "batch-1",
                "operations": [{"action": "insert", "path": [1], "value": {"type": "paragraph"}}],
            }
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://thought"
            ) as browser:
                first = await browser.post(
                    path, headers={HEADER: auth.headers[HEADER]}, json=request
                )
                assert first.status_code == 200, first.text
                assert first.json()["revision"] == 1
                retry = await browser.post(
                    path, headers={HEADER: auth.headers[HEADER]}, json=request
                )
                assert retry.status_code == 200 and retry.json() == first.json()
        async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
            outcomes = list(await session.scalars(select(ThoughtReferenceMutation)))
            assert len(outcomes) == 2
            assert all(
                outcome.state == "commit" and outcome.change["asset_ids"] == [case.asset]
                for outcome in outcomes
            )
        await ThoughtReferenceDelivery(case.db.sessions, client).process_once()
        async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
            assert all(
                row.state == "delivered"
                for row in await session.scalars(select(ThoughtReferenceMutation))
            )
    await live.close()


async def test_thought_upload_delegates_real_session_to_owned_assets_only(scenario, tmp_path):
    import hashlib

    from fpl_runtime.delegation import RequestGrant
    from fpl_runtime.thought_uploads import ThoughtUploadDescription, upload_path

    case = scenario
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live
    source_path = "/v1/thought-workshop/images"
    source = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": "POST",
            "X-Fpl-Request-Uri": source_path,
            "X-CSRF-Token": case.csrf,
            "Origin": "http://127.0.0.1:19000",
        },
    )
    assert source.status_code == 204
    content = b"\x89PNG\r\n\x1a\nprivate upload"
    desc = ThoughtUploadDescription(
        "image", "viewer.png", "image/png", len(content), hashlib.sha256(content).hexdigest()
    )
    target = upload_path("image", "test-request", desc.fingerprint)
    grant = RequestGrant(
        "thought", "thought.library.upload", "POST", source_path, "assets", "POST", target
    )
    async with httpx.AsyncClient(transport=case.mesh) as client:
        delegation = await client.post(
            "http://identity/_internal/v1/authorization/delegate",
            headers={"Authorization": "Bearer " + THOUGHT_SECRET},
            json={**asdict(grant), "assertion": source.headers[HEADER]},
        )
        assert delegation.status_code == 200, delegation.text
        token = delegation.json()["assertion"]
        headers = {
            HEADER: token,
            "X-Fpl-Upload-Descriptor": desc.header(),
            "X-Fpl-Upload-Nonce": "a" * 32,
        }
        upload = await client.post("http://assets" + target, headers=headers, content=content)
        assert upload.status_code == 200, upload.text
        retry = await client.post("http://assets" + target, headers=headers, content=content)
        assert retry.status_code == 200 and retry.json()["id"] == upload.json()["id"]
        from fpl_runtime.capability_client import CapabilityDenied
        from fpl_thought.upload_transport import send_staged_upload

        staged = tmp_path / "thought-upload"
        staged.write_bytes(content)
        options = dict(
            path=staged,
            description=desc,
            request_id="test-request",
            assertion=source.headers[HEADER],
            source_path=source_path,
            credential=THOUGHT_SECRET,
            receipt_credential="u" * 48,
            owner=case.viewer,
            catalog=CATALOG,
            transport=case.mesh,
        )
        result = await send_staged_upload(**options)
        assert result.id == upload.json()["id"]
        assert staged.read_bytes() == content
        from fpl_thought.upload_intents import deliver_staged_upload, stage_path, stage_upload
        from fpl_thought.upload_records import ThoughtUploadIntent

        async with case.db.sessions(info={"owner_user_id": case.viewer}) as session:
            await stage_upload(
                session,
                root=tmp_path,
                owner=case.viewer,
                request_id="test-request",
                description=desc,
                incoming=UploadFile(io.BytesIO(content), filename="viewer.png"),
            )
            staged_copy = stage_path(tmp_path, case.viewer, "test-request", desc.fingerprint)
            assert staged_copy.read_bytes() == content
            delivery = await deliver_staged_upload(
                session,
                root=tmp_path,
                owner=case.viewer,
                request_id="test-request",
                description=desc,
                assertion=source.headers[HEADER],
                source_path=source_path,
                credential=THOUGHT_SECRET,
                receipt_credential="u" * 48,
                catalog=CATALOG,
                transport=case.mesh,
            )
            assert delivery.id == result.id and not staged_copy.exists()
            row = await session.get(ThoughtUploadIntent, (case.viewer, "test-request"))
            assert row.state == "confirmed" and row.result == {
                "asset_id": result.id,
                "filename": result.original_filename,
                "mime_type": result.mime_type,
                "byte_size": result.byte_size,
            }
        forbidden = await client.post(
            "http://identity/_internal/v1/authorization/delegate",
            headers={"Authorization": "Bearer " + THOUGHT_SECRET},
            json={
                **asdict(grant),
                "source_path": "/v1/thought-workshop/attachments",
                "assertion": source.headers[HEADER],
            },
        )
        assert forbidden.status_code == 403
        logout = await case.browser.post(
            "/v1/auth/logout",
            headers={"X-CSRF-Token": case.csrf, "Origin": "http://127.0.0.1:19000"},
        )
        assert logout.status_code == 204
        assert (
            await client.post("http://assets" + target, headers=headers, content=content)
        ).status_code == 401
        with pytest.raises(CapabilityDenied):
            await send_staged_upload(**options)
        assert staged.read_bytes() == content
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        row = await session.get(VisualAsset, upload.json()["id"])
        assert row.owner_user_id == case.viewer
    async with case.assets.state.database.sessions(info={"owner_user_id": case.owner}) as session:
        assert await session.get(VisualAsset, row.id) is None
    await live.close()


async def test_thought_directory_mutations_use_owned_revisions_and_withdraw(scenario):
    from fpl_runtime.retention_client import RetentionClient
    from fpl_thought.application import create_app as create_thought

    case = scenario
    app = create_thought(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=RetentionClient(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )
    headers = {
        "X-Fpl-Gateway": GATEWAY_SECRET,
        "X-Fpl-Ingress": "local",
        "X-Fpl-Client-Ip": "127.0.0.1",
    }
    async with app.router.lifespan_context(app):
        async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
            session.add(
                ThoughtNote(
                    id="home",
                    owner_user_id=case.owner,
                    knowledge_base_id="book",
                    title="Home",
                    is_home=True,
                    kind="note",
                    document={"type": "doc", "content": []},
                    search_text="",
                )
            )
            book = await session.get(ThoughtKnowledgeBase, "book")
            book.home_note_id = "home"
            await session.commit()
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=case.identity),
                base_url="http://127.0.0.1:19000",
                headers=headers,
            ) as owner,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://thought"
            ) as thought,
        ):
            assert (
                await owner.post(
                    "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
                )
            ).status_code == 200

            async def call(browser, method, path, **kwargs):
                token = await browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        "X-Fpl-Target-Service": "thought",
                        "X-Fpl-Request-Method": method,
                        "X-Fpl-Request-Uri": path,
                        "X-CSRF-Token": browser.cookies["fpl_csrf"],
                        "Origin": "http://127.0.0.1:19000",
                    },
                )
                assert token.status_code == 204, token.text
                return await thought.request(
                    method, path, headers={HEADER: token.headers[HEADER]}, **kwargs
                )

            path = "/v1/thought-workshop/knowledge-bases/book"
            assert (
                await call(case.browser, "DELETE", path, params={"expected_revision": 0})
            ).status_code == 404
            trash = await call(owner, "DELETE", path, params={"expected_revision": 0})
            assert trash.status_code == 200, trash.text
            assert trash.json()["deleted_at"] is not None and trash.json()["revision"] == 1
            async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
                assert not (await session.get(Publication, "pub")).active
            stale = await call(owner, "POST", path + "/restore", json={"expected_revision": 0})
            assert stale.status_code == 409
            restored = await call(owner, "POST", path + "/restore", json={"expected_revision": 1})
            assert restored.status_code == 200 and restored.json()["deleted_at"] is None
            move = await call(
                owner, "POST", path + "/move", json={"expected_revision": 2, "item_id": "note"}
            )
            assert move.status_code == 200, move.text
            assert move.json()["knowledge_base"]["revision"] == 3
            note_path = "/v1/thought-workshop/notes/note"
            note_trash = await call(
                owner,
                "DELETE",
                note_path,
                params={"expected_revision": 1, "expected_knowledge_revision": 3},
            )
            assert note_trash.status_code == 200, note_trash.text
            restored_note = await call(
                owner,
                "POST",
                note_path + "/restore",
                json={"expected_revision": 2, "expected_knowledge_revision": 4},
            )
            assert restored_note.status_code == 200, restored_note.text
            assert restored_note.json()["deleted_at"] is None


async def test_thought_lifespan_recovers_pre_intent_upload_under_service_lock(scenario):
    from fpl_runtime.locking import service_lock
    from fpl_runtime.retention_client import RetentionClient
    from fpl_thought.application import create_app as create_thought
    from fpl_thought.upload_intents import stage_path

    case = scenario
    orphan = stage_path(case.db.root, case.viewer, "interrupted", "a" * 64)
    orphan.write_bytes(b"partial upload")
    app = create_thought(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=RetentionClient(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )
    async with app.router.lifespan_context(app):
        assert not orphan.exists()
        with pytest.raises(RuntimeError, match="另一个实例"):
            with service_lock(case.db.root):
                pass
