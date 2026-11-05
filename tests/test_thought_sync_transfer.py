"""Rehearse stopped sync history and require explicit review of an unknown write."""

import asyncio
import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_assets import ASSET_RECORDS, transfer_asset_blobs
from scripts.website.migrate_thought_documents import verify_relationships
from scripts.website.migrate_thought_references import verify_sync_originals
from scripts.website.migration_transfer import pages, project_datasets, transfer
from scripts.website.verify_thought_sync_connections import CONNECTIONS, verify_connections
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from tests.test_tools_navigation_migration import available_ports, listener

from app.capabilities.asset_store.models import VisualAsset
from app.integrations.external.models import ExternalConnection
from app.runtime.credentials import SecretCipher
from db.migrations import apply_migrations
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from studio.apps.identity.storage.models.accounts import User
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from studio.apps.thought_workshop.external_sync.records import ArticleSyncRecords
from studio.apps.thought_workshop.external_sync.schemas import ArticleSyncReconcile
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.storage.service_models import MODELS
from studio.apps.thought_workshop.synchronization.sync_reconcile import reconcile_task
from studio.apps.thought_workshop.synchronization.sync_runner import SyncRunner
from studio.assembly.independent.thought_workshop.maintenance import DATASETS, PREFIX
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database

ORIGINAL = b"isolated original for the old Feishu task"


def create_legacy(path, owner, visitor, key):
    apply_migrations(path)
    identifiers = {
        name: str(uuid4())
        for name in ("book", "note", "binding", "connection", "asset", "running", "queued", "step")
    }
    identifier = SimpleNamespace(**identifiers)
    engine = create_engine(f"sqlite:///{path}")
    try:
        with Session(engine) as db:
            for account, name in ((owner, "author"), (visitor, "visitor")):
                db.add(
                    User(
                        id=str(account),
                        username=name,
                        username_normalized=name,
                        password_hash="fixture",
                    )
                )
            db.flush()
            db.add(
                ThoughtKnowledgeBase(
                    id=identifier.book,
                    owner_user_id=str(owner),
                    title="同步隔离样本",
                    home_note_id=identifier.note,
                )
            )
            db.add(
                ExternalConnection(
                    id=identifier.connection,
                    owner_user_id=str(owner),
                    name="Fixture Feishu",
                    app_id="fixture-app",
                    secret_ciphertext=SecretCipher(key).encrypt("fixture-secret"),
                )
            )
            db.flush()
            db.add(
                ThoughtNote(
                    id=identifier.note,
                    owner_user_id=str(owner),
                    knowledge_base_id=identifier.book,
                    is_home=True,
                    title="原文章",
                    revision=3,
                    document={"type": "doc", "content": [{"type": "paragraph"}]},
                )
            )
            db.add(
                VisualAsset(
                    id=identifier.asset,
                    owner_user_id=str(owner),
                    storage_key="fixture.png",
                    storage_version=1,
                    original_filename="fixture.png",
                    display_name="fixture.png",
                    media_kind="image",
                    mime_type="image/png",
                    byte_size=len(ORIGINAL),
                )
            )
            db.flush()
            db.add(
                ArticleSyncBinding(
                    id=identifier.binding,
                    owner_user_id=str(owner),
                    note_id=identifier.note,
                    connection_id=identifier.connection,
                    document_id="Doc1",
                    target_key="feishu:Doc1",
                    url="https://example.feishu.cn/docx/Doc1",
                    title="旧远端",
                    revision=2,
                )
            )
            db.flush()
            remote = {"document_id": "Doc1", "revision": 4, "fingerprint": "a" * 64}
            db.add(
                ArticleSyncTask(
                    id=identifier.running,
                    owner_user_id=str(owner),
                    note_id=identifier.note,
                    binding_id=identifier.binding,
                    binding_revision=2,
                    connection_id=identifier.connection,
                    connection_revision=1,
                    target_key="feishu:Doc1",
                    note_revision=3,
                    status="running",
                    actor={"user_id": str(owner), "auth_kind": "session", "api_key_id": None},
                    operation_id=f"{uuid4()}:{uuid4()}",
                    content={"asset_ids": [identifier.asset]},
                    remote=remote,
                    checkpoint={"remote": remote, "appended": True},
                    message="旧站已经尝试写入",
                )
            )
            db.add(
                ArticleSyncTask(
                    id=identifier.queued,
                    owner_user_id=str(owner),
                    note_id=str(uuid4()),
                    binding_id=str(uuid4()),
                    binding_revision=1,
                    connection_id=identifier.connection,
                    connection_revision=1,
                    target_key="feishu:Removed",
                    note_revision=1,
                    status="queued",
                    actor={"user_id": str(owner), "auth_kind": "session"},
                    operation_id=str(uuid4()),
                    content={"asset_ids": []},
                    remote={"document_id": "Removed"},
                    checkpoint={},
                )
            )
            db.flush()
            db.add(
                ArticleSyncStep(
                    id=identifier.step, task_id=identifier.running, kind="delete_prefix"
                )
            )
            db.add(ArticleSyncAsset(task_id=identifier.running, asset_id=identifier.asset))
            db.commit()
    finally:
        engine.dispose()
    file = path.parent / "accounts" / str(owner) / "legacy-assets" / "fixture.png"
    file.parent.mkdir(parents=True)
    file.write_bytes(ORIGINAL)
    return identifier


def test_restore_old_external_sync_for_review_without_remote_replay(tmp_path):
    owner, visitor = uuid4(), uuid4()
    key = Fernet.generate_key().decode()
    old = tmp_path / "legacy" / "future-props.db"
    old.parent.mkdir()
    ids = create_legacy(old, owner, visitor, key)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="d" * 40,
        source_database_sha256=digest(old),
        owner_ids=(owner, visitor),
        token="isolated-thought-sync-migration-credential",
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps({**plan.model_dump(mode="json"), "token": plan.token.get_secret_value()})
    )
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    thought, assets, integrations = (
        tmp_path / name for name in ("thought", "assets", "integrations")
    )
    for root, service, migrations in (
        (thought, "thought", MIGRATIONS),
        (assets, "assets", ASSET_MIGRATIONS),
        (integrations, "integrations", INTEGRATION_MIGRATIONS),
    ):
        apply(root / "service.db", service, migrations)
    config = tmp_path / "integrations.toml"
    config.touch(mode=0o600)
    config.write_text(
        "[storage]\ndatabase_path = "
        + json.dumps(str(integrations / "service.db"))
        + "\n[security]\nsecrets_key = "
        + json.dumps(key)
        + "\n"
    )
    datasets = project_datasets(PREFIX, DATASETS)
    grouped = {entry.name: entry for entry in datasets}

    def open_service(client, owner_module, port, state=None):
        prefix = {
            "thought_workshop": datasets[0].prefix,
            "asset_library": ASSET_RECORDS[0].prefix,
            "integrations": CONNECTIONS.prefix,
        }[owner_module]
        config_args = ("--config", config) if owner_module == "integrations" else ()
        args = (
            ("migration-export", "--legacy-db", old)
            if state is None
            else ("migration-import", "--state-root", state)
        )
        command, *options = args
        return listener(
            client,
            port,
            command,
            plan_file,
            *options,
            *config_args,
            module=f"studio.assembly.independent.{owner_module}.cli",
            prefix=prefix,
        )

    with httpx.Client(timeout=20, trust_env=False) as client:
        old_port, new_port = available_ports()
        with open_service(client, "thought_workshop", old_port) as source:
            with open_service(client, "thought_workshop", new_port, thought) as target:
                reports = {ds.name: transfer(client, plan, source, target, ds) for ds in datasets}
                for name, count in (("bindings", 1), ("tasks", 2), ("steps", 1), ("assets", 1)):
                    assert reports[f"thought.sync-{name}"]["record_count"] == count
                proof = verify_relationships(client, plan, source, target)
                assert proof["file_links"]["sync_assets"]["record_count"] == 1
                tasks = grouped["thought.sync-tasks"]
                records = {
                    row.id: row
                    for page in pages(client, target, headers, plan, owner, tasks)
                    for row in page.batch.records
                }
                record = records[ids.running]
                assert record.status == "needs_review"
                assert record.checkpoint["legacy_cutover_status"] == "running"
                assert record.checkpoint["appended"] is True
                assert ":" in record.operation_id
                assert records[ids.queued].status == "failed"
                foreign = next(
                    page.batch
                    for page in pages(client, target, headers, plan, owner, tasks)
                    if page.batch.records[0].id == ids.running
                ).model_copy(update={"owner_id": visitor, "batch_id": uuid4()})
                mismatched = foreign.model_copy(
                    update={
                        "owner_id": owner,
                        "batch_id": uuid4(),
                        "records": (
                            record.model_copy(
                                update={
                                    "checkpoint": {
                                        **record.checkpoint,
                                        "remote": {"document_id": "WrongDoc"},
                                    }
                                }
                            ),
                        ),
                    }
                )
                rejected = client.post(
                    target + tasks.prefix + "/batches",
                    headers={**headers, "X-Fpl-Migration-SHA256": mismatched.digest},
                    json=mismatched.model_dump(mode="json"),
                )
                assert rejected.status_code == 409
                assert rejected.json()["code"] == "migration_thought_sync_target_conflict"
                denied = client.post(
                    target + tasks.prefix + "/batches",
                    headers={**headers, "X-Fpl-Migration-SHA256": foreign.digest},
                    json=foreign.model_dump(mode="json"),
                )
                assert denied.status_code == 409
                assert denied.json()["code"] == "migration_thought_sync_note_owner_conflict"

            with open_service(client, "thought_workshop", new_port, thought) as target:
                for name in ("bindings", "tasks", "steps", "assets"):
                    dataset = grouped[f"thought.sync-{name}"]
                    assert transfer(client, plan, source, target, dataset) == reports[dataset.name]
                src_port, dst_port = available_ports()
                with (
                    open_service(client, "integrations", src_port) as original,
                    open_service(client, "integrations", dst_port, integrations) as receiver,
                ):
                    with pytest.raises(ValueError, match="集成连接缺失或归属不符"):
                        verify_connections(client, plan, target, receiver)
                    assert (
                        transfer(client, plan, original, receiver, CONNECTIONS)["record_count"] == 1
                    )
                    assert verify_connections(client, plan, target, receiver)["record_count"] == 2

                src_port, dst_port = available_ports()
                with (
                    open_service(client, "asset_library", src_port) as original,
                    open_service(client, "asset_library", dst_port, assets) as receiver,
                ):
                    with pytest.raises(ValueError, match="素材原件缺失或归属不符"):
                        verify_sync_originals(client, plan, target, receiver)
                    for dataset in ASSET_RECORDS:
                        transfer(client, plan, original, receiver, dataset)
                    transfer_asset_blobs(client, plan, original, receiver)
                    report = verify_sync_originals(client, plan, target, receiver)
                    evidence = [
                        str(owner),
                        {"asset_id": ids.asset, "task_id": ids.running},
                        hashlib.sha256(ORIGINAL).hexdigest(),
                    ]
                    expected = hashlib.sha256(
                        json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode() + b"\n"
                    ).hexdigest()
                    assert (report["record_count"], report["sha256"]) == (1, expected)

    async def verify_runtime():
        database = Database("thought", thought, models=MODELS)
        remote_reads = []
        closed = []

        async def sweep(known):
            assert not any(known)

        async def read_document(connection, revision, document):
            remote_reads.append((connection, revision, document))
            return SimpleNamespace(text="远端待人工核对")

        async def close_task(task_id):
            closed.append(task_id)

        async def discard(staging):
            assert staging == ""

        try:
            # No transport means any attempt at a remote write fails this fixture.
            runner = SyncRunner(
                database.sessions, transport=None, artifacts=SimpleNamespace(sweep=sweep)
            )
            await runner.recover()
            await runner.process_once()
            async with database.sessions(info={"owner_user_id": str(owner)}) as db:
                actor = SimpleNamespace(allows=lambda _permission: True)
                records = ArticleSyncRecords(db, str(owner), actor)
                reads = SimpleNamespace(read_document=read_document, close_task=close_task)
                state = SimpleNamespace(thought_sync_artifacts=SimpleNamespace(discard=discard))
                response = await reconcile_task(
                    records, reads, state, ids.note, ids.running, ArticleSyncReconcile()
                )
                assert response.task.status == "needs_review" and not response.can_resume
                assert remote_reads == [(ids.connection, 1, "Doc1")]
                assert (await db.get(ArticleSyncStep, ids.step)).status == "pending"
                response = await reconcile_task(
                    records,
                    reads,
                    state,
                    ids.note,
                    ids.running,
                    ArticleSyncReconcile(acknowledge_partial=True),
                )
                assert response.task.status == "failed" and closed == [ids.running]
                assert await db.get(ArticleSyncAsset, (ids.running, ids.asset)) is None
        finally:
            await database.close()

    asyncio.run(verify_runtime())
