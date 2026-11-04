"""Exercise the maintenance CLI on an isolated database created by legacy migrations."""

import hashlib
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
from contextlib import closing, contextmanager
from uuid import uuid4

import httpx
import pytest
from scripts.website.migrate_tools_navigation import transfer

from db.migrations.runner import apply_migrations
from fpl_runtime.migration_batches import MAX_RECORDS, MigrationPlan
from fpl_runtime.migrations import apply
from fpl_tools.migration_application import PREFIX
from fpl_tools.migrations.registry import MIGRATIONS
from fpl_tools.navigation_migration import NavigationPage


def legacy_database(path, owner, other):
    apply_migrations(path)
    with closing(sqlite3.connect(path)) as database, database:
        database.execute("PRAGMA foreign_keys=ON")
        database.executemany(
            """INSERT INTO users (id, username, username_normalized, password_hash)
               VALUES (?, ?, ?, ?)""",
            [
                (str(owner), "source", "source", "fixture"),
                (str(other), "other", "other", "fixture"),
            ],
        )
        database.executemany(
            """INSERT INTO tool_navigation_items (
                 owner_user_id, tool_id, is_favorite, favorite_updated_at,
                 last_used_at, use_count, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    str(account),
                    f"tool-{index:03}",
                    index % 2 == 0,
                    "2025-01-02 03:04:05" if index % 2 == 0 else None,
                    "2025-03-04 05:06:07",
                    index + 3,
                    "2025-03-04 05:07:08",
                )
                for account, size in ((owner, MAX_RECORDS + 1), (other, 1))
                for index in range(size)
            ],
        )


def available_ports():
    with socket.socket() as first, socket.socket() as second:
        for listener in (first, second):
            listener.bind(("127.0.0.1", 0))
        return tuple(listener.getsockname()[1] for listener in (first, second))


@contextmanager
def listener(client, port, command, plan, *args):
    address = f"http://127.0.0.1:{port}"
    with subprocess.Popen(
        [
            sys.executable,
            "-m",
            "fpl_tools",
            command,
            "--port",
            str(port),
            "--migration-plan",
            str(plan),
            *map(str, args),
        ],
        env={**os.environ, "PYTHONPATH": "backend:."},
        stdout=subprocess.DEVNULL,
    ) as proc:
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline and proc.poll() is None:
                try:
                    if client.get(f"{address}{PREFIX}/inventory").status_code == 403:
                        break
                except httpx.ConnectError:
                    pass
                time.sleep(0.05)
            else:
                pytest.fail(f"{command} did not start")
            yield address
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=10)


def test_migrate_tools_navigation_across_restarts(tmp_path):
    owner, other = uuid4(), uuid4()
    legacy = tmp_path / "legacy.sqlite"
    legacy_database(legacy, owner, other)
    source_digest = hashlib.sha256(legacy.read_bytes()).hexdigest()
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="a" * 40,
        source_database_sha256=source_digest,
        owner_ids=(owner, other),
        token="local-fixture-" * 3,
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
    target = tmp_path / "tools"
    apply(target / "service.db", "tools", MIGRATIONS)
    source_port, target_port = available_ports()
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}

    with (
        httpx.Client(timeout=5, trust_env=False) as client,
        listener(client, source_port, "migration-export", plan_file, "--legacy-db", legacy) as src,
    ):
        url = f"{src}{PREFIX}/{owner}"
        assert client.get(url).status_code == 403
        assert (
            client.get(url, headers={**headers, "Origin": "https://example.test"}).status_code
            == 403
        )
        assert client.get(f"{src}{PREFIX}/{uuid4()}", headers=headers).status_code == 409
        page = NavigationPage.model_validate(client.get(url, headers=headers).json())
        assert len(page.batch.records) == MAX_RECORDS and page.next_cursor == "tool-255"
        first = page.batch.records[0]
        assert first.is_favorite and first.use_count == 3
        assert first.favorite_updated_at.isoformat() == "2025-01-02T03:04:05"
        assert first.last_used_at.isoformat() == "2025-03-04T05:06:07"
        assert first.updated_at.isoformat() == "2025-03-04T05:07:08"

        def submit(dest, batch, *, digest=None):
            return client.post(
                f"{dest}{PREFIX}/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": digest or batch.digest},
                json=batch.model_dump(mode="json"),
            )

        with listener(
            client, target_port, "migration-import", plan_file, "--state-root", target
        ) as dst:
            assert submit(dst, page.batch, digest="0" * 64).status_code == 422
            foreign = page.batch.model_copy(update={"run_id": uuid4()})
            assert submit(dst, foreign).status_code == 409
            response = submit(dst, page.batch)
            assert response.status_code == 200
            receipt = response.json()

        with listener(
            client, target_port, "migration-import", plan_file, "--state-root", target
        ) as dst:
            assert submit(dst, page.batch).json() == receipt
            modified = first.model_copy(update={"use_count": 98})
            conflict = page.batch.model_copy(update={"records": (modified,)})
            assert submit(dst, conflict).status_code == 409
            new_record = first.model_copy(update={"tool_id": "different-key"})
            overlap = conflict.model_copy(
                update={"batch_id": uuid4(), "records": (new_record, modified)}
            )
            assert submit(dst, overlap).status_code == 409
            report = transfer(client, plan, src, dst)
            assert report["record_count"] == MAX_RECORDS + 2
            assert transfer(client, plan, src, dst) == report
            os.utime(legacy, ns=(legacy.stat().st_atime_ns, legacy.stat().st_mtime_ns + 1000))
            assert client.get(url, headers=headers).status_code == 409
    restricted = plan.model_copy(update={"owner_ids": (owner,)})
    plan_file.write_text(
        json.dumps(
            {
                **restricted.model_dump(mode="json", exclude={"token"}),
                "token": restricted.token.get_secret_value(),
            }
        )
    )
    with (
        httpx.Client(timeout=5, trust_env=False) as client,
        listener(client, source_port, "migration-export", plan_file, "--legacy-db", legacy) as src,
    ):
        assert client.get(f"{src}{PREFIX}/inventory", headers=headers).status_code == 409
    assert hashlib.sha256(legacy.read_bytes()).hexdigest() == source_digest
