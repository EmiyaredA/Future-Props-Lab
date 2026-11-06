"""Replay an interrupted Workbench transfer, then verify ownership and the derived index."""

import json
import sqlite3
from contextlib import closing
from uuid import uuid4

import httpx
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_agents_history import verify_index
from scripts.website.migration_transfer import pages, project_datasets, transfer

from db.migrations import apply_migrations
from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.agent_workbench.maintenance import DATASETS, PREFIX
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from tests.apps.tools.test_tools_navigation_migration import available_ports, listener


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


def test_agents_history_preserves_owner_and_rebuilds_search_across_restarts(tmp_path):
    owner, other = uuid4(), uuid4()
    source_db = tmp_path / "legacy.sqlite"
    turn_id, queued_id, session_id = seed(source_db, owner, other)
    target = tmp_path / "agents"
    apply(target / "service.db", "agents", MIGRATIONS)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="a" * 40,
        source_database_sha256=digest(source_db),
        owner_ids=(owner, other),
        token="isolated-workbench-fixture-token-" * 2,
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps(
            {
                **plan.model_dump(mode="json", exclude={"token"}),
                "token": plan.token.get_secret_value(),
            }
        )
    )
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    projects, chats, turns, sources, sessions, entries, checkpoints, operations, changes = (
        project_datasets(PREFIX, DATASETS)
    )
    source_port, target_port = available_ports()

    def open_source(client):
        return listener(
            client,
            source_port,
            "migration-export",
            plan_file,
            "--legacy-db",
            source_db,
            module="studio.assembly.independent.agent_workbench.cli",
            prefix=projects.prefix,
        )

    def open_target(client):
        return listener(
            client,
            target_port,
            "migration-import",
            plan_file,
            "--state-root",
            target,
            module="studio.assembly.independent.agent_workbench.cli",
            prefix=projects.prefix,
        )

    with httpx.Client(timeout=10, trust_env=False) as client, open_source(client) as source:
        with open_target(client) as destination:
            for dataset in (projects, chats, turns, sources, sessions):
                assert transfer(client, plan, source, destination, dataset)["record_count"] >= 1
            page = next(pages(client, source, headers, plan, owner, entries))
            invalid = page.batch.model_copy(update={"owner_id": other, "batch_id": uuid4()})
            denied = client.post(
                destination + entries.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": invalid.digest},
                json=invalid.model_dump(mode="json"),
            )
            assert (
                denied.status_code == 409
                and denied.json()["code"] == "migration_agents_owner_conflict"
            )
            assert transfer(client, plan, source, destination, entries)["record_count"] == 1
            changed = page.batch.model_copy(
                update={
                    "records": (
                        page.batch.records[0].model_copy(update={"text": "changed entry"}),
                    ),
                }
            )
            conflict = client.post(
                destination + entries.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": changed.digest},
                json=changed.model_dump(mode="json"),
            )
            assert (
                conflict.status_code == 409
                and conflict.json()["code"] == "migration_batch_conflict"
            )

        with open_target(client) as destination:
            datasets = (
                projects,
                chats,
                turns,
                sources,
                sessions,
                entries,
                checkpoints,
                operations,
                changes,
            )
            reports = [transfer(client, plan, source, destination, dataset) for dataset in datasets]
            assert [report["record_count"] for report in reports] == [1, 1, 2, 1, 1, 1, 1, 1, 2]
            assert [
                transfer(client, plan, source, destination, dataset) for dataset in datasets
            ] == reports
            index = verify_index(client, plan, source, destination)
            assert index["record_count"] == 1
            moved = {
                item.id: item
                for page in pages(client, destination, headers, plan, owner, turns)
                for item in page.batch.records
            }
            assert moved[turn_id].status == "interrupted"
            assert moved[turn_id].approvals[0]["status"] == "unknown"
            assert (
                moved[queued_id].status == "queued" and moved[queued_id].queued_session_id is None
            )
            assert (
                next(pages(client, destination, headers, plan, owner, chats))
                .batch.records[0]
                .queue_paused
            )
            assert (
                next(pages(client, destination, headers, plan, owner, operations))
                .batch.records[0]
                .status
                == "failed"
            )
            assert (
                next(pages(client, destination, headers, plan, owner, sessions)).batch.records[0].id
                == session_id
            )
