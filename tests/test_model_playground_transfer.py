"""Verify playground relationships, originals and normal recovery after migration."""

import asyncio
import json
import sqlite3
from contextlib import closing
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_model_catalog import HISTORY
from scripts.website.migrate_model_inference import manifest, transfer_model_originals
from scripts.website.migration_transfer import pages, transfer
from tests.test_tools_navigation_migration import available_ports, listener

from db.migrations.runner import apply_migrations
from studio.apps.model_service.playground.attachments import AttachmentError, ModelTestAttachments
from studio.apps.model_service.playground.recovery import recover_interrupted_model_test_runs
from studio.apps.model_service.playground.service import ModelTestService
from studio.apps.model_service.storage.migration_originals import ATTACHMENTS
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_test import (
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestMessage,
)
from studio.config.settings import Settings
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def seed(legacy, owner, other):
    apply_migrations(legacy)
    conversation, foreign, sent, pending, foreign_message, turn = (str(uuid4()) for _ in range(6))
    originals = legacy.parent / "accounts" / str(owner) / "model-test" / "attachments"
    staging = originals / ".tmp"
    staging.mkdir(parents=True)
    (staging / uuid4().hex).write_bytes(b"interrupted upload")
    attachments = []
    with closing(sqlite3.connect(legacy)) as database, database:
        database.execute("PRAGMA foreign_keys=ON")
        database.executemany(
            "INSERT INTO users(id,username,username_normalized,password_hash) VALUES (?,?,?,?)",
            [
                (str(owner), "source", "source", "fixture"),
                (str(other), "other", "other", "fixture"),
            ],
        )
        database.executemany(
            """INSERT INTO model_test_conversations (
                 id, owner_user_id, title, system_prompt, temperature, max_tokens,
                 revision, created_at, updated_at
               ) VALUES (?, ?, 'Historical conversation', 'context', 0.7, 512, 4,
                         '2025-01-01 00:00:00', '2025-01-01 00:00:00')""",
            [(conversation, str(owner)), (foreign, str(other))],
        )
        database.executemany(
            """INSERT INTO model_test_messages (
                 id, conversation_id, position, turn_id, role, content, model_slug, status,
                 created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, 'fixture', ?,
                         '2025-01-01 00:00:00', '2025-01-01 00:00:00')""",
            [
                (sent, conversation, 0, turn, "user", "owned image", "completed"),
                (pending, conversation, 1, turn, "assistant", "partial response", "pending"),
                (foreign_message, foreign, 0, str(uuid4()), "user", "another owner", "completed"),
            ],
        )
        for message_id, color in ((sent, "blue"), (None, "orange")):
            identifier, key = str(uuid4()), uuid4().hex
            path = originals / key
            Image.new("RGB", (2, 3), color).save(path, format="PNG")
            database.execute(
                """INSERT INTO model_test_attachments (
                     id, conversation_id, message_id, position, original_filename, storage_key,
                     mime_type, byte_size, width, height, created_at
                   ) VALUES (?, ?, ?, 0, 'fixture.png', ?, 'image/png', ?, 2, 3, '2025-01-01')""",
                (identifier, conversation, message_id, key, path.stat().st_size),
            )
            attachments.append((identifier, path))
    return conversation, foreign_message, attachments


async def verify_playground(target, owner, other, conversation, attachments):
    database = Database(
        "models", target, models=(ModelTestConversation, ModelTestAttachment, ModelTestMessage)
    )
    settings = Settings(fpl_database_path=str(database.path))
    try:
        await recover_interrupted_model_test_runs(database.sessions)
        async with database.sessions(info={"owner_user_id": str(owner)}) as session:
            restored = await ModelTestService(session, str(owner), settings).get(conversation)
            assert restored.revision == 5
            assert [item.status for item in restored.messages] == ["completed", "cancelled"]
            assert restored.messages[1].content == "partial response"
            assert restored.messages[0].attachments[0].id == attachments[0][0]
            assert restored.draft_attachments[0].id == attachments[1][0]
            reader = ModelTestAttachments(session, settings, str(owner))
            for identifier, original in attachments:
                _row, restored_path = await reader.content(conversation, identifier)
                assert digest(restored_path) == digest(original)
                assert not (restored_path.parent / ".tmp").exists()
        async with database.sessions(info={"owner_user_id": str(other)}) as session:
            reader = ModelTestAttachments(session, settings, str(other))
            draft = attachments[1][0]
            for operation in (reader.content, reader.delete_draft):
                with pytest.raises(AttachmentError) as error:
                    await operation(conversation, draft)
                assert error.value.status == 404
    finally:
        await database.close()


def test_playground_migration_preserves_drafts_and_recovers_partial_message(tmp_path):
    owner, other = uuid4(), uuid4()
    legacy = tmp_path / "legacy.db"
    conversation, foreign_message, attachments = seed(legacy, owner, other)
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="a" * 40,
        source_database_sha256=digest(legacy),
        owner_ids=(owner, other),
        token="fixture-model-playground-" * 2,
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
    config = tmp_path / "models.toml"
    config.touch(mode=0o600)
    config.write_text(
        "[storage]\ndatabase_path = "
        + json.dumps(str(target / "service.db"))
        + "\n[security]\nsecrets_key = "
        + json.dumps(Fernet.generate_key().decode())
        + "\n"
    )
    conversations, messages, records = HISTORY[3:6]
    src_port, dst_port = available_ports()
    options = {
        "module": "studio.assembly.independent.model_service.cli",
        "prefix": records.prefix,
    }
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
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

        with target_listener() as destination:
            assert transfer(client, plan, source, destination, conversations)["record_count"] == 2
            assert transfer(client, plan, source, destination, messages)["record_count"] == 3
            page = next(pages(client, source, headers, plan, owner, records))
            linked = page.batch.records[0].model_copy(update={"message_id": foreign_message})
            altered = page.batch.model_copy(update={"records": (linked,)})
            rejected = client.post(
                destination + records.prefix + "/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": altered.digest},
                json=altered.model_dump(mode="json"),
            )
            assert rejected.status_code == 409
            assert rejected.json()["code"] == "migration_model_test_attachment_message_conflict"
            assert transfer(client, plan, source, destination, records)["record_count"] == 2
            files = manifest(client, source, owner, headers, complete=True, scope=ATTACHMENTS)
            assert len(files) == 2
            item = files[0]
            tail = f"/attachments/{item.id}/{item.size}/{item.sha256}"
            route = f"{ATTACHMENTS.prefix}/{owner}{tail}"
            assert (
                client.get(
                    f"{source}{ATTACHMENTS.prefix}/{other}{tail}", headers=headers
                ).status_code
                == 409
            )
            with client.stream("GET", source + route, headers=headers) as response:
                assert response.status_code == 200
                accepted = client.put(
                    destination + route, content=response.iter_bytes(), headers=headers
                )
            assert accepted.status_code == 200
        with target_listener() as destination:
            report = transfer_model_originals(client, plan, source, destination)
            assert report["test_attachments"]["record_count"] == 2
            assert transfer_model_originals(client, plan, source, destination) == report
    asyncio.run(verify_playground(target, owner, other, conversation, attachments))
    assert digest(legacy) == plan.source_database_sha256
