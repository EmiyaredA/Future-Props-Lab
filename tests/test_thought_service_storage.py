"""Independent Thought owns its document graph without Identity, Models or Assets tables."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote, ThoughtNoteAsset
from app.apps.thought_workshop.publication.models import Publication
from app.apps.thought_workshop.publication.use_cases import Community
from app.llm.models import ModelEntry
from fpl_runtime.database import Database, ServiceSession, ServiceStorageError
from fpl_runtime.migrations import apply, check
from fpl_thought.migrations.registry import MIGRATIONS
from fpl_thought.models import ACCOUNT_MODELS, MODELS


def test_thought_schema_owns_every_registered_table_without_external_fks(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "thought", MIGRATIONS)
    apply(path, "thought", MIGRATIONS)
    check(path, "thought", MIGRATIONS)
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {model.__tablename__ for model in MODELS} | {"_fpl_service_schema"}
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
from fpl_thought.models import MODELS
from app.apps.thought_workshop import assistant
assert len(MODELS) == 30
for name in ('app.orm', 'app.runtime.db', 'app.console.models.accounts',
             'app.llm.models', 'app.capabilities.asset_store.models'):
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
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply
from fpl_thought.migrations.registry import MIGRATIONS
from fpl_thought.models import MODELS, ACCOUNT_MODELS
from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote

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
    for name in ("app.runtime.db", "app.orm", "app.console.models.accounts", "app.llm.models",
                 "app.capabilities.asset_store.models"):
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
