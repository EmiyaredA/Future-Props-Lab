"""Replay Models call and inference history through isolated maintenance listeners."""

import asyncio
import json
import sqlite3
from contextlib import closing
from types import SimpleNamespace
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from scripts.website.legacy_snapshot import digest
from scripts.website.migrate_model_catalog import HISTORY
from scripts.website.migrate_model_inference import manifest, transfer_inference_originals
from scripts.website.migration_transfer import pages, transfer
from tests.test_tools_navigation_migration import available_ports, listener

from db.migrations.runner import apply_migrations
from studio.apps.model_service.generation.outcomes import SUBMISSION_INTERRUPTED_MESSAGE
from studio.apps.model_service.inference.runner import InferenceRunner
from studio.apps.model_service.storage.migration_originals import INFERENCE
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database

PREFIX = INFERENCE.prefix


def seed_inference(database, root, owner, call):
    finished, uncertain, asset = (str(uuid4()) for _ in range(3))
    input_key, output_key = uuid4().hex, "native-" + str(uuid4())
    output = b"audio" * (7 * 1024 * 1024)
    input_file = b"owned input file"
    files = root / "accounts" / str(owner) / "model-inference"
    for kind, key, data in (("inputs", input_key, input_file), ("outputs", output_key, output)):
        folder = files / kind
        folder.mkdir(parents=True)
        (folder / key).write_bytes(data)
    (files / "outputs" / f"{uuid4().hex}.tmp").write_bytes(b"unfinished staging")
    database.executemany(
        """INSERT INTO model_inference_tasks (
             id, owner_user_id, request_id, fingerprint, provider_kind, provider_name,
             model_slug, kind, request_payload, status, progress, provider_task_id, result_url,
             result_storage_key, result_filename, result_mime_type, result_byte_size, result,
             log_id, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'openai', 'Provider', 'fixture', 'speech_synthesis',
                     ?, ?, ?, '', '', ?, ?, ?, ?, '{}', ?, 3,
                     '2025-01-01 00:00:00', '2025-01-01 00:01:00')""",
        [
            (
                finished,
                str(owner),
                "completed-request",
                "a" * 64,
                json.dumps({"asset_ids": [asset], "reference_asset_id": asset}),
                "completed",
                100,
                output_key,
                "test.wav",
                "audio/wav",
                len(output),
                call,
            ),
            (
                uncertain,
                str(owner),
                "unknown-request",
                "b" * 64,
                "{}",
                "submitting",
                0,
                "",
                "",
                "",
                0,
                None,
            ),
        ],
    )
    database.execute(
        """INSERT INTO model_inference_assets (
             id, owner_user_id, task_id, storage_key, filename, mime_type, media_kind,
             byte_size, created_at
           ) VALUES (?, ?, ?, ?, 'ref.wav', 'audio/wav', 'audio', ?, '2025-01-01 00:00:00')""",
        (asset, str(owner), finished, input_key, len(input_file)),
    )
    return uncertain, files


async def verify_recovery(target, owner, uncertain):
    database = Database(
        "models", target, models=(ModelInferenceTask, ModelInferenceAsset, LlmCallLog)
    )
    try:

        async def forbidden_submit(_task):
            raise AssertionError("未知提交不得重发")

        runner = InferenceRunner(database.sessions, settings=SimpleNamespace(runtime_path=target))
        runner.driver.submit = forbidden_submit
        await runner.recover()
        async with database.sessions(info={"owner_user_id": str(owner)}) as session:
            recovered = await session.get(ModelInferenceTask, uncertain)
            assert recovered.status == "failed"
            assert recovered.error_message == SUBMISSION_INTERRUPTED_MESSAGE
            assert recovered.revision == 4
            assert (await session.get(LlmCallLog, recovered.log_id)).trace_id == uncertain
    finally:
        await database.close()


def test_models_history_preserves_owned_payloads_and_replays_after_restart(tmp_path):
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
        uncertain, files = seed_inference(database, tmp_path, owner, call)
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
            for dataset, count in zip(HISTORY[1:3], (2, 1), strict=True):
                assert transfer(client, plan, source, destination, dataset)["record_count"] == count
            originals = manifest(client, source, owner, headers, complete=True)
            assert len(originals) == 2 and originals[1].size > 32 * 1024 * 1024
            item = originals[0]
            file = f"/{item.kind}/{item.id}/{item.size}/{item.sha256}"
            assert (
                client.get(source + PREFIX + f"/{other}" + file, headers=headers).status_code == 409
            )
            assert (
                client.put(
                    destination + PREFIX + f"/{owner}" + file, content=b"wrong", headers=headers
                ).status_code
                == 409
            )
            with client.stream(
                "GET", source + PREFIX + f"/{owner}" + file, headers=headers
            ) as response:
                accepted = client.put(
                    destination + PREFIX + f"/{owner}" + file,
                    content=response.iter_bytes(),
                    headers=headers,
                )
            assert accepted.status_code == 200
        with target_listener() as destination:
            result = transfer_inference_originals(client, plan, source, destination)
            assert result["record_count"] == result["task_count"] == 2
            assert transfer_inference_originals(client, plan, source, destination) == result
    asyncio.run(verify_recovery(target, owner, uncertain))
    restored = target / files.relative_to(tmp_path)
    for original in (*files.joinpath("inputs").iterdir(), *files.joinpath("outputs").iterdir()):
        if original.suffix == ".tmp":
            assert not (restored / "outputs" / original.name).exists()
        else:
            target_file = restored / original.parent.name / original.name
            assert digest(target_file) == digest(original)
    assert digest(legacy) == source_digest
