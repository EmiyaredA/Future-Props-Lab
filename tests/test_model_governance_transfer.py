"""Exercise owned quota and cross-account template history on the maintenance apps."""

import asyncio
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
from studio.apps.model_service.admission.admission import ModelAdmission
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_templates import (
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
)
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.service_models import TemplateSyncAuthority
from studio.apps.model_service.template_sync import TemplateSynchronization
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def seed_governance(path, admin, owner, cipher):
    apply_migrations(path)
    job, synchronous = str(uuid4()), str(uuid4())
    payload = {
        "providers": [
            {
                "template_key": "fixture",
                "name": "Fixture",
                "kind": "openai",
                "api_key_ciphertext": cipher.encrypt(b"fixture-key").decode(),
            }
        ]
    }
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        db.executemany(
            "INSERT INTO users(id,username,username_normalized,password_hash) VALUES (?,?,?,?)",
            [
                (str(admin), "operator", "operator", "fixture"),
                (str(owner), "recipient", "recipient", "fixture"),
            ],
        )
        db.execute(
            """INSERT INTO model_template_sync_jobs (
                 id, role, template_revision, template_snapshot, actor_user_id, status, revision
               ) VALUES (?, 'user', 2, ?, ?, 'running', 4)""",
            (job, json.dumps(payload), str(admin)),
        )
        db.execute(
            """INSERT INTO model_template_sync_items (
                 id, job_id, owner_user_id, account_name, catalog_revision, status, summary
               ) VALUES (?, ?, ?, 'Recipient', 5, 'pending', '{"retained":["one"]}')""",
            (str(uuid4()), job, str(owner)),
        )
        # Released admissions can reference tasks that have since been deleted.
        db.execute(
            """INSERT INTO runtime_admissions (
                 id, user_id, owner_user_id, platform_role, task_kind, task_ids, released_at
               ) VALUES (?, ?, ?, 'user', 'visual', ?, '2025-01-01 00:00:00')""",
            (str(uuid4()), str(owner), str(owner), json.dumps([str(uuid4())])),
        )
        db.execute(
            """INSERT INTO runtime_admissions (id, user_id, owner_user_id, platform_role)
               VALUES (?, ?, ?, 'admin')""",
            (synchronous, str(admin), str(admin)),
        )
    return job, synchronous


async def verify_recovery(target, admin, job, synchronous):
    database = Database(
        "models",
        target,
        models=(
            ModelTemplateSyncJob,
            ModelTemplateSyncItem,
            TemplateSyncAuthority,
            RuntimeAdmission,
        ),
        account_models=(RuntimeAdmission,),
    )
    try:
        await ModelAdmission(database.sessions).recover()
        # Missing original signed authority must never trigger a new directory decision.
        synchronization = TemplateSynchronization(database.sessions, directory=None)
        await synchronization.process_job(job)
        await synchronization.process_job(job)
        async with database.sessions(info={"owner_user_id": str(admin)}) as session:
            assert (await session.get(RuntimeAdmission, synchronous)).released_at is not None
            saved = await session.get(ModelTemplateSyncJob, job)
            assert (saved.status, saved.revision) == ("completed", 6)
    finally:
        await database.close()


def test_models_governance_transfer_preserves_targets_and_rejects_live_peer_lease(tmp_path):
    admin, owner = uuid4(), uuid4()
    secret = Fernet.generate_key()
    legacy = tmp_path / "legacy.db"
    job_id, synchronous = seed_governance(legacy, admin, owner, Fernet(secret))
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="b" * 40,
        source_database_sha256=digest(legacy),
        owner_ids=(admin, owner),
        token="model-governance-isolated-fixture-" * 2,
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

    def use_key(key):
        config.write_text(
            "[storage]\ndatabase_path = "
            + json.dumps(str(target / "service.db"))
            + "\n[security]\nsecrets_key = "
            + json.dumps(key.decode())
            + "\n"
        )

    jobs, items, admissions = HISTORY[9:12]
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    options = {"module": "studio.assembly.independent.model_service.cli", "prefix": jobs.prefix}
    src_port, dst_port = available_ports()
    with (
        httpx.Client(timeout=15, trust_env=False) as client,
        listener(
            client, src_port, "migration-export", plan_file, "--legacy-db", legacy, **options
        ) as source,
    ):

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

        def submit(address, dataset, batch):
            return client.post(
                address + dataset.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": batch.digest},
                json=batch.model_dump(mode="json"),
            )

        job = next(pages(client, source, headers, plan, admin, jobs)).batch
        item = next(pages(client, source, headers, plan, admin, items)).batch
        lease = next(pages(client, source, headers, plan, owner, admissions)).batch
        assert item.records[0].owner_user_id == str(owner)
        assert lease.records[0].released_at is not None
        use_key(Fernet.generate_key())
        with target_listener() as destination:
            rejected = submit(destination, jobs, job)
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_model_credential_unreadable"
        use_key(secret)
        with target_listener() as destination:
            assert submit(destination, jobs, job).status_code == 200
            invalid = item.records[0].model_copy(update={"owner_user_id": str(uuid4())})
            rejected = submit(destination, items, item.model_copy(update={"records": (invalid,)}))
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_model_sync_account_conflict"
            active = lease.records[0].model_copy(update={"released_at": None})
            rejected = submit(
                destination, admissions, lease.model_copy(update={"records": (active,)})
            )
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_model_external_admission_active"
            assert submit(destination, admissions, lease).status_code == 200
        with target_listener() as destination:
            for dataset in (jobs, items, admissions):
                report = transfer(client, plan, source, destination, dataset)
                assert report["record_count"] == (2 if dataset is admissions else 1)
                assert transfer(client, plan, source, destination, dataset) == report
    asyncio.run(verify_recovery(target, admin, job_id, synchronous))
    assert digest(legacy) == plan.source_database_sha256
