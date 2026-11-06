"""Verify that a sealed website snapshot retains retired workbench data."""

import json
import sqlite3
from contextlib import closing
from uuid import uuid4

from cryptography.fernet import Fernet
from scripts.website import legacy_snapshot
from scripts.website.migration_coverage import inspect_bundle

from db.migrations import apply_migrations
from studio.contracts.management.migration_batches import MigrationPlan
from tests.integration.test_website_legacy_snapshot import REVISION, ROOT, configuration


def seed(path, owner, other):
    apply_migrations(path)
    project, chat, turn, queued, source, session, entry, checkpoint, operation = (
        str(uuid4()) for _ in range(9)
    )
    now = "2026-11-05 09:00:00"
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        db.executemany(
            "INSERT INTO users (id,username,username_normalized,password_hash) VALUES (?,?,?,?)",
            [
                (str(owner), "source", "source", "fixture"),
                (str(other), "other", "other", "fixture"),
            ],
        )
        db.execute(
            "INSERT INTO workbench_projects (id,owner_user_id,root,last_used_at) VALUES (?,?,?,?)",
            (project, str(owner), "/fixture/project", 15),
        )
        db.execute(
            "INSERT INTO workbench_chats (id,owner_user_id,project_id,agent_id,created_at) "
            "VALUES (?,?,?,?,?)",
            (chat, str(owner), project, "codex", 16),
        )
        db.executemany(
            "INSERT INTO workbench_turns "
            "(id,owner_user_id,chat_id,client_id,position,prompt,answer,status,approvals,revision,"
            "queued_session_id,queued_local) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    turn,
                    str(owner),
                    chat,
                    "run",
                    1,
                    "old prompt",
                    "partial answer",
                    "running",
                    '[{"id":"fixture","kind":"write","title":"x","preview":"+x","status":"executing"}]',
                    2,
                    None,
                    True,
                ),
                (
                    queued,
                    str(owner),
                    chat,
                    "backlog",
                    2,
                    "queued",
                    "",
                    "queued",
                    "[]",
                    1,
                    str(uuid4()),
                    True,
                ),
            ],
        )
        db.execute(
            "INSERT INTO agent_workbench_sources "
            "(id,owner_user_id,agent_id,label,root,endpoint,enabled,revision,status,message,"
            "created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                source,
                str(owner),
                "codex",
                "Fixture",
                "/fixture/native",
                "",
                True,
                1,
                "ready",
                "",
                now,
            ),
        )
        db.execute(
            "INSERT INTO agent_workbench_sessions "
            "(id,owner_user_id,agent_id,native_id,title,alias,favorite,revision,cwd,origins,evidence,"
            "native_model,archived,updated_at,last_synced_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                session,
                str(owner),
                "codex",
                "native-session",
                "Fixture",
                "Retained alias",
                True,
                3,
                "/fixture/project",
                "[]",
                "[]",
                "fixture-model",
                False,
                now,
                now,
            ),
        )
        db.execute(
            "INSERT INTO agent_workbench_entries "
            "(id,session_id,native_id,ordinal,role,kind,text,timestamp,tool_name,attachments) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                entry,
                session,
                "native-entry",
                4,
                "assistant",
                "message",
                "verified Workbench history",
                now,
                "",
                "[]",
            ),
        )
        db.execute(
            "INSERT INTO agent_workbench_checkpoints (id,source_id,session_id,locator,state,error) "
            "VALUES (?,?,?,?,?,?)",
            (checkpoint, source, session, "fixture.jsonl", '{"offset":42}', ""),
        )
        db.execute(
            "INSERT INTO agent_workbench_operations "
            "(id,owner_user_id,source_id,status,message,created_at) VALUES (?,?,?,?,?,?)",
            (operation, str(owner), source, "queued", "", now),
        )
        db.executemany(
            "INSERT INTO agent_workbench_changes (id,owner_user_id,session_id,kind,created_at) "
            "VALUES (?,?,?,?,?)",
            [(9, str(owner), session, "session", now), (10, str(owner), session, "session", now)],
        )
    return turn, queued, session


def test_retired_workbench_is_restored_from_the_sealed_website_snapshot(tmp_path):
    runtime = tmp_path / ".runtime"
    runtime.mkdir(mode=0o700)
    source = runtime / legacy_snapshot.DATABASE
    owner, other = uuid4(), uuid4()
    turn_id, queued_id, session_id = seed(source, owner, other)
    config = tmp_path / "backend/config.toml"
    configuration(
        config, database=source, key=Fernet.generate_key().decode(), port=19002, web=tmp_path
    )

    sealed = tmp_path / "sealed"
    seal = legacy_snapshot.create(runtime, config, sealed, REVISION)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=REVISION,
        source_database_sha256=legacy_snapshot.digest(source),
        owner_ids=(owner, other),
        token="isolated-workbench-fixture-token-" * 2,
    )
    catalog = json.loads((ROOT / "deploy/contracts/ownership.json").read_text())
    report = inspect_bundle(
        sealed, plan=plan, manifest_sha256=seal["manifest_sha256"], catalog=catalog
    )
    archived = {row["table"]: row for row in report["tables"] if row["service"] == "agents"}
    assert archived["workbench_turns"]["record_count"] == 2
    assert archived["agent_workbench_sessions"]["record_count"] == 1
    assert {row["status"] for row in archived.values()} == {"retained_for_rollback"}

    restored = tmp_path / "restored"
    legacy_snapshot.restore(sealed, restored, REVISION, seal["manifest_sha256"])
    database = restored / legacy_snapshot.RUNTIME / legacy_snapshot.DATABASE
    assert legacy_snapshot.digest(database) == legacy_snapshot.digest(source)
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute(
            "SELECT owner_user_id, answer FROM workbench_turns WHERE id=?", (turn_id,)
        ).fetchone() == (str(owner), "partial answer")
        assert db.execute(
            "SELECT status FROM workbench_turns WHERE id=?", (queued_id,)
        ).fetchone() == ("queued",)
        assert db.execute(
            "SELECT owner_user_id, alias FROM agent_workbench_sessions WHERE id=?", (session_id,)
        ).fetchone() == (str(owner), "Retained alias")
