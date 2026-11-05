"""Independent Thought owns its document graph without Identity, Models or Assets tables."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from studio.apps.model_service.storage.models.model_service import ModelEntry
from studio.apps.thought_workshop.publication.models import Publication
from studio.apps.thought_workshop.publication.use_cases import Community
from studio.apps.thought_workshop.storage.migration_receipts import ThoughtImportReceipt
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.models import (
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
)
from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.runtime.database.migrations import apply, check
from studio.runtime.database.sessions import Database, ServiceSession, ServiceStorageError


def test_thought_schema_owns_every_registered_table_without_external_fks(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "thought", MIGRATIONS)
    apply(path, "thought", MIGRATIONS)
    check(path, "thought", MIGRATIONS)
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {model.__tablename__ for model in (*MODELS, ThoughtImportReceipt)} | {
            "_fpl_service_schema"
        }
        assert not tables.intersection(
            {"users", "visual_assets", "llm_call_logs", "integration_external_connections"}
        )
        for table in tables:
            assert all(
                row[2] in tables for row in db.execute(f'PRAGMA foreign_key_list("{table}")')
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    # Shared recovery ORM keeps its original physical identity and asset relationships.
    assert any(
        fk.target_fullname == "users.id" for fk in ThoughtKnowledgeBase.__table__.foreign_keys
    )
    assert any(
        fk.target_fullname == "visual_assets.id" for fk in ThoughtNoteAsset.__table__.foreign_keys
    )
    with pytest.raises(ValueError, match="归属"):
        apply(path, "models", MIGRATIONS)


def test_thought_models_and_writing_import_without_foreign_orm_or_global_db():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
from studio.apps.thought_workshop.storage.service_models import MODELS
from studio.apps.thought_workshop import assistant
assert len(MODELS) == 33
for name in ('studio.assembly.website.models',
    'studio.runtime.database.website',
    'studio.apps.identity.storage.models.accounts',
    'studio.apps.model_service.storage.models',
    'studio.apps.asset_library.storage.models'):
    assert name not in sys.modules, name
""",
        ],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def test_community_preserves_service_guard_and_request_directory(tmp_path):
    apply(tmp_path / "service.db", "thought", MIGRATIONS)
    database = Database("thought", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    try:
        for owner in ("alpha", "beta"):
            async with database.sessions(info={"owner_user_id": owner}) as session:
                library = ThoughtKnowledgeBase(id="book-" + owner, owner_user_id=owner, title=owner)
                session.add(library)
                await session.flush()
                session.add(
                    ThoughtNote(
                        id="note-" + owner,
                        owner_user_id=owner,
                        knowledge_base_id=library.id,
                        title=owner,
                        document={"type": "doc", "content": []},
                        search_text="",
                        kind="note",
                    )
                )
                await session.flush()
                session.add(
                    Publication(
                        id="pub-" + owner,
                        owner_user_id=owner,
                        knowledge_base_id=library.id,
                        publisher_id=owner,
                        title=owner,
                    )
                )
                await session.commit()
        directory = object()
        async with database.sessions(
            info={"owner_user_id": "beta", "thought_directory": directory}
        ) as request_session:
            community = Community(request_session, SimpleNamespace(user_id="beta"))
            async with community.sessions() as source_session:
                assert isinstance(source_session.sync_session, ServiceSession)
                assert source_session.info["thought_directory"] is directory
                assert source_session.info["owner_user_id"] is None
                assert source_session.info["allow_system_reads"] is True
                assert len(list(await source_session.scalars(select(Publication)))) == 2
                with pytest.raises(ServiceStorageError, match="其他服务"):
                    await source_session.scalars(select(ModelEntry))
                # Registry reads never grant account writes without explicit binding.
                source_session.add(ThoughtKnowledgeBase(owner_user_id="alpha", title="unbound"))
                with pytest.raises(ServiceStorageError, match="账号上下文"):
                    await source_session.flush()
                await source_session.rollback()
        async with database.sessions(info={"owner_user_id": "beta"}) as session:
            assert list(await session.scalars(select(ThoughtKnowledgeBase.id))) == ["book-beta"]
    finally:
        await database.close()


def test_fresh_process_creates_owned_documents_without_loading_foreign_models(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = """
import asyncio
import sys
from pathlib import Path
from studio.runtime.database.sessions import Database
from studio.runtime.database.migrations import apply
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.service_models import MODELS, ACCOUNT_MODELS
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote

async def run():
    root = Path(sys.argv[1])
    apply(root / "service.db", "thought", MIGRATIONS)
    database = Database("thought", root, models=MODELS, account_models=ACCOUNT_MODELS)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="owned-book", owner_user_id="alpha", title="Owned"))
        await session.flush()
        session.add(ThoughtNote(
            id="owned-note", owner_user_id="alpha", knowledge_base_id="owned-book",
            title="Owned", document={"type": "doc", "content": []},
            search_text="", kind="note"))
        await session.commit()
    await database.close()
    for name in ("studio.runtime.database.website",
        "studio.assembly.website.models",
        "studio.apps.identity.storage.models.accounts",
        "studio.apps.model_service.storage.models",
                 "studio.apps.asset_library.storage.models"):
        assert name not in sys.modules, name
asyncio.run(run())
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_fresh_process_commits_note_batch_and_receipt_without_foreign_models(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = """
import asyncio
import sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.schemas.operations import ThoughtOperationsIn
from studio.runtime.database.project_operations import ProjectOperationReceipt
from studio.contracts.identity.claims import Actor
from studio.runtime.database.sessions import Database
from studio.runtime.database.migrations import apply
from studio.contracts.asset_library.retention_authority import issue_retention
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.apps.thought_workshop.note_retention import apply_operations_with_references
from studio.apps.thought_workshop.retention import ThoughtReferences
from studio.apps.thought_workshop.storage.retention_records import ThoughtReferenceMutation

class Remote:
    def __init__(self, key): self.key = key
    async def authorize(self, *, change, **kwargs):
        actor = Actor("alpha", "user", "session", ("studio:write",), session_id="s")
        return issue_retention(actor, caller="thought", change=change,
                               private_key=self.key, key_id="k")
    async def prepare(self, **kwargs): return {"intent_id": "intent", "state": "prepared"}

async def run():
    root = Path(sys.argv[1]); apply(root / "service.db", "thought", MIGRATIONS)
    database = Database("thought", root, models=MODELS, account_models=ACCOUNT_MODELS)
    key = Ed25519PrivateKey.generate()
    references = ThoughtReferences(database.sessions, Remote(key), public_key=key.public_key())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="alpha", title="Book"))
        await session.flush()
        session.add(ThoughtNote(id="note", owner_user_id="alpha", knowledge_base_id="book",
            title="Note", document={"type": "doc", "content": []}, search_text="", kind="note"))
        await session.commit()
        body = ThoughtOperationsIn(expected_revision=0, request_id="one", operations=[
            {"action": "insert", "path": [0], "value": {"type": "paragraph"}}])
        result = await apply_operations_with_references(session, owner="alpha", author_id=None,
            note_id="note", body=body, assertion="source", source_method="POST",
            source_path="/v1/thought-workshop/notes/note/operations", references=references)
        assert result.revision == 1
        assert (await session.scalar(select(ProjectOperationReceipt))).request_id == "one"
        assert (await session.scalar(select(ThoughtReferenceMutation))).state == "commit"
    await database.close()
    for name in ("studio.runtime.database.website",
        "studio.assembly.website.models",
        "studio.apps.identity.storage.models.accounts",
        "studio.apps.model_service.storage.models",
                 "studio.apps.asset_library.storage.models"):
        assert name not in sys.modules, name
asyncio.run(run())
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def test_incomplete_thought_assembly_locks_storage_and_cannot_report_ready(tmp_path):
    import httpx
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
    from studio.assembly.independent.thought_workshop.application import create_app
    from studio.contracts.gateway.routing import RouteCatalog
    from studio.runtime.lifecycle.locking import service_lock

    class Client:
        async def close(self):
            pass

    apply(tmp_path / "service.db", "thought", MIGRATIONS)
    root = Path(__file__).resolve().parents[1]
    app = create_app(
        state_root=tmp_path,
        catalog=RouteCatalog.read(root / "deploy/contracts/ownership.json"),
        public_key=Ed25519PrivateKey.generate().public_key(),
        credential="thought-service-credential-" * 2,
        identity=Client(),
        retention_client=Client(),
        assets_peer_credential="assets-peer-credential-" * 2,
        run_worker=False,
    )
    async with app.router.lifespan_context(app):
        with pytest.raises(RuntimeError, match="另一个实例"):
            with service_lock(tmp_path):
                pass
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            assert (await c.get("/health")).status_code == 200
            assert (await c.get("/ready")).status_code == 503
            assert (await c.put("/v1/thought-workshop/notes/note", json={})).status_code == 401
    with service_lock(tmp_path):
        pass


def test_thought_assembly_preserves_published_operation_ids(tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from studio.assembly.independent.thought_workshop.application import create_app
    from studio.contracts.gateway.routing import RouteCatalog

    root = Path(__file__).resolve().parents[1]
    catalog = RouteCatalog.read(root / "deploy" / "contracts" / "ownership.json")
    app = create_app(
        state_root=tmp_path,
        catalog=catalog,
        public_key=Ed25519PrivateKey.generate().public_key(),
        credential="i" * 48,
        assets_peer_credential="p" * 48,
        identity=None,
        retention_client=None,
        run_worker=False,
        schema_path=root / "web/src/generated/openapi.json",
    )
    expected = {
        (entry.method, entry.path): entry.operation_id
        for entry in catalog.operations
        if entry.service == "thought"
    }
    actual = {
        (method.upper(), path): operation["operationId"]
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/v1/")
        for method, operation in operations.items()
    }
    assert {key: expected[key] for key in actual} == actual
    assert actual.keys() == expected.keys()
