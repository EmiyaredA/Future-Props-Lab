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
from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.playground.recovery import recover_interrupted_model_test_runs
from studio.apps.model_service.playground.service import ModelTestService
from studio.apps.model_service.playground.transcription_runner import ModelTestTranscriptionRunner
from studio.apps.model_service.storage.migration_originals import ATTACHMENTS, PLAYGROUND_TASKS
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_test import (
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestGenerationTask,
    ModelTestMessage,
    ModelTestTranscriptionTask,
)
from studio.apps.model_service.transport.migration_originals_http import TEST_RELATIONSHIPS
from studio.config.settings import Settings
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def seed_tasks(db, root, owner):
    generation, uncertain, reference, transcription = (str(uuid4()) for _ in range(4))
    generated_key, reference_key, transcription_key = (uuid4().hex for _ in range(3))
    paths = []
    for folder, key, content in (
        ("generated", generated_key, b"generated video" * (3 * 1024 * 1024)),
        ("references", reference_key, b"original image"),
        ("references", transcription_key, b"transcription original"),
    ):
        path = root / folder / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        paths.append(path)
    db.executemany(
        """INSERT INTO model_test_generation_tasks (
             id, owner_user_id, provider_kind, generation_kind, provider_name, model_slug,
             request_payload, status, progress, result_storage_key, result_byte_size,
             result_filename, result_mime_type, revision, created_at, updated_at
           ) VALUES (?, ?, 'volcengine_video', 'video', 'fixture', 'fixture', ?, ?, ?, ?, ?,
                     ?, ?, 2, '2025-01-01 00:00:00', '2025-01-01 00:00:00')""",
        [
            (
                generation,
                str(owner),
                json.dumps({"first_frame_asset_id": reference}),
                "completed",
                100,
                generated_key,
                paths[0].stat().st_size,
                "result.mp4",
                "video/mp4",
            ),
            (uncertain, str(owner), "{}", "submitting", 0, None, None, None, None),
        ],
    )
    db.execute(
        """INSERT INTO model_test_generation_assets (
             id, owner_user_id, task_id, role, position, original_filename, storage_key,
             media_kind, mime_type, byte_size, created_at
           ) VALUES (?, ?, ?, 'reference_image', 0, 'original.png', ?,
                     'image', 'image/png', ?, '2025-01-01 00:00:00')""",
        (reference, str(owner), generation, reference_key, paths[1].stat().st_size),
    )
    db.execute(
        """INSERT INTO model_test_transcription_tasks (
             id, owner_user_id, provider_kind, provider_name, model_slug, source_kind,
             input_storage_key, input_filename, input_mime_type, input_byte_size, language,
             request_options, status, result_text, result_segments, result_detail,
             revision, created_at, updated_at
           ) VALUES (?, ?, 'openai', 'fixture', 'fixture', 'upload', ?, 'input.wav', 'audio/wav',
                     ?, 'auto', '{}', 'running', 'partial', '[]', '{}', 1,
                     '2025-01-01 00:00:00', '2025-01-01 00:00:00')""",
        (transcription, str(owner), transcription_key, paths[2].stat().st_size),
    )
    return uncertain, transcription, paths


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
        tasks = seed_tasks(database, originals.parent, owner)
    return conversation, foreign_message, attachments, tasks


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


async def verify_task_recovery(target, owner, source_root, tasks):
    uncertain, transcription, originals = tasks
    database = Database(
        "models", target, models=(ModelTestGenerationTask, ModelTestTranscriptionTask, LlmCallLog)
    )
    settings = Settings(fpl_database_path=str(database.path))
    generation = ModelTestGenerationRunner(database.sessions, settings=settings)
    try:
        await generation.recover()
        await ModelTestTranscriptionRunner(database.sessions, settings=settings).recover()
        async with database.sessions(info={"owner_user_id": str(owner)}) as session:
            generation_row = await session.get(ModelTestGenerationTask, uncertain)
            transcription_row = await session.get(ModelTestTranscriptionTask, transcription)
            assert (generation_row.status, generation_row.revision) == ("failed", 3)
            assert (transcription_row.status, transcription_row.revision) == ("failed", 2)
            assert transcription_row.result_text == "partial"
            for row in (generation_row, transcription_row):
                log = await session.get(LlmCallLog, row.log_id)
                assert (log.owner_user_id, log.status) == (str(owner), "error")
        for original in originals:
            assert digest(target / original.relative_to(source_root)) == digest(original)
    finally:
        await generation.stop()
        await database.close()


def test_playground_migration_preserves_drafts_and_recovers_partial_message(tmp_path):
    owner, other = uuid4(), uuid4()
    legacy = tmp_path / "legacy.db"
    conversation, foreign_message, attachments, tasks = seed(legacy, owner, other)
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
    generations, references, transcriptions = HISTORY[6:9]
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
            assert transfer(client, plan, source, destination, generations)["record_count"] == 2
            incomplete = client.get(destination + TEST_RELATIONSHIPS, headers=headers)
            assert incomplete.status_code == 409
            assert incomplete.json()["code"] == "migration_model_test_references_unresolved"
            assert transfer(client, plan, source, destination, references)["record_count"] == 1
            assert transfer(client, plan, source, destination, transcriptions)["record_count"] == 1
            originals = manifest(
                client, source, owner, headers, complete=True, scope=PLAYGROUND_TASKS
            )
            assert len(originals) == 3
            assert originals[0].kind == "generated" and originals[0].size > 32 * 1024 * 1024
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
            assert report["test_tasks"]["record_count"] == 3
            assert report["test_tasks"]["generation_task_count"] == 2
            assert transfer_model_originals(client, plan, source, destination) == report
    asyncio.run(verify_playground(target, owner, other, conversation, attachments))
    asyncio.run(verify_task_recovery(target, owner, tmp_path, tasks))
    assert digest(legacy) == plan.source_database_sha256
