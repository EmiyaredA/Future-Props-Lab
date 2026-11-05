"""Replay private Models call history through the isolated maintenance listeners."""

import json
import sqlite3
from contextlib import closing
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_model_catalog import HISTORY
from scripts.website.migration_transfer import pages, transfer
from tests.test_tools_navigation_migration import available_ports, listener

from db.migrations.runner import apply_migrations
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply


def test_models_call_history_preserves_owned_payloads_and_replays_after_restart(tmp_path):
    owner, other = sorted((uuid4(), uuid4()))
    legacy = tmp_path / "legacy.db"
    apply_migrations(legacy)
    call = str(uuid4())
    response = {"choices": [{"content": "x" * (3 * 1024 * 1024)}]}
    with closing(sqlite3.connect(legacy)) as database, database:
        database.execute("PRAGMA foreign_keys=ON")
        for account, name in ((owner, "source"), (other, "other")):
            database.execute(
                "INSERT INTO users(id,username,username_normalized,password_hash) VALUES (?,?,?,?)",
                (str(account), name, name, "fixture"),
            )
        database.executemany(
            """INSERT INTO llm_call_logs (
                id, owner_user_id, call_source, provider_kind, model, auth_kind,
                trace_id, request_payload, response_payload, latency_ms, status, created_at
            ) VALUES (?, ?, 'model-test', 'openai', 'legacy-fixture', 'session',
                      ?, ?, ?, 12, 'success', '2025-01-01 00:00:00')""",
            [
                (call, str(owner), str(uuid4()), '{"prompt":"owned"}', json.dumps(response)),
                (str(uuid4()), str(other), str(uuid4()), '{"prompt":"other"}', "{}"),
            ],
        )
    source_digest = digest(legacy)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="a" * 40,
        source_database_sha256=source_digest,
        owner_ids=(owner, other),
        token="fixture-model-call-logs-" * 2,
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
    target = tmp_path / "models"
    apply(target / "service.db", "models", MIGRATIONS)
    config = tmp_path / "isolated.toml"
    config.touch(mode=0o600)
    config.write_text(
        "[storage]\ndatabase_path = "
        + json.dumps(str(target / "service.db"))
        + "\n[security]\nsecrets_key = "
        + json.dumps(Fernet.generate_key().decode())
        + "\n"
    )
    src_port, dst_port = available_ports()
    logs = HISTORY[0]
    options = {"module": "studio.assembly.independent.model_service.cli", "prefix": logs.prefix}
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    with (
        httpx.Client(timeout=15, trust_env=False) as client,
        listener(
            client, src_port, "migration-export", plan_file, "--legacy-db", legacy, **options
        ) as source,
    ):
        original = next(pages(client, source, headers, plan, owner, logs))
        assert original.batch.records[0].response_payload == response
        assert original.batch.records[0].id == call
        assert client.get(f"{source}{logs.prefix}/{uuid4()}", headers=headers).status_code == 409

        def target_listener():
            return listener(
                client,
                dst_port,
                "migration-import",
                plan_file,
                "--state-root",
                target,
                "--config",
                config,
                **options,
            )

        with target_listener() as destination:
            args = {"json": original.batch.model_dump(mode="json")}
            batch_url = destination + logs.prefix + "/batches"
            assert (
                client.post(
                    batch_url, headers={**headers, "X-Fpl-Migration-SHA256": "0" * 64}, **args
                ).status_code
                == 422
            )
            accepted = client.post(
                batch_url, headers={**headers, "X-Fpl-Migration-SHA256": original.sha256}, **args
            )
            assert accepted.status_code == 200
            assert accepted.json()["record_count"] == 1
        with target_listener() as destination:
            report = transfer(client, plan, source, destination, logs)
            assert report["record_count"] == 2
            assert transfer(client, plan, source, destination, logs) == report
            other_page = next(pages(client, destination, headers, plan, other, logs))
            assert [row.request_payload for row in other_page.batch.records] == [
                {"prompt": "other"}
            ]
    assert digest(legacy) == source_digest
