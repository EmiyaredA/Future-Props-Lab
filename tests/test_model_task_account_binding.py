"""Background transitions use Models-owned tables and one account per write transaction."""

import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from studio.apps.model_service.generation.driver import GenerationTaskDriver, GenerationTaskStore
from studio.apps.model_service.playground.transcription_runner import ModelTestTranscriptionRunner
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.apps.model_service.storage.models.model_service import ModelProvider
from studio.apps.model_service.storage.models.model_test import ModelTestTranscriptionTask
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.config.settings import get_settings as isolated_settings
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database, ServiceStorageError
from studio.runtime.database.task_records import load_runner_task
from studio.runtime.secrets import SecretCipher


@pytest.fixture
async def database(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    try:
        for owner in ("alpha", "beta"):
            async with database.sessions(info={"owner_user_id": owner}) as session:
                session.add(
                    ModelProvider(
                        id="provider-" + owner,
                        owner_user_id=owner,
                        name="Owned provider",
                        kind="zealman_video",
                        base_url="https://provider.invalid/v1",
                    )
                )
                await session.flush()
                for status in ("queued", "submitting", "pending", "completed"):
                    session.add(
                        ModelInferenceTask(
                            id=f"{owner}-{status}",
                            owner_user_id=owner,
                            request_id=status,
                            fingerprint="f" * 64,
                            provider_id="provider-" + owner,
                            provider_kind="zealman_video",
                            provider_name="Owned provider",
                            model_slug="fixture",
                            kind="video",
                            status=status,
                            provider_task_id="upstream" if status == "pending" else "",
                        )
                    )
                session.add(
                    ModelTestTranscriptionTask(
                        id="transcription-" + owner,
                        owner_user_id=owner,
                        provider_kind="senseaudio_asr",
                        provider_name="Owned provider",
                        model_slug="fixture",
                        source_kind="upload",
                        input_storage_key="input-" + owner,
                        input_filename="fixture.wav",
                        input_mime_type="audio/wav",
                        input_byte_size=100,
                        status="running",
                    )
                )
                await session.commit()
        yield database
    finally:
        await database.close()


def store(database, **options):
    return GenerationTaskStore(
        session_factory=database.sessions,
        task_type=ModelInferenceTask,
        active_statuses={"queued", "submitting", "pending", "processing"},
        task_subject="owned inference task",
        **options,
        decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
    )


async def test_runner_lookup_never_rebinds_an_existing_account_or_uses_identity_cache(database):
    async with database.sessions(info={"allow_system_reads": True}) as session:
        cached = await session.get(ModelInferenceTask, "beta-queued")
        session.info["owner_user_id"] = "alpha"
        assert await store(database).load(session, cached.id) is None
        assert session.info["owner_user_id"] == "alpha"
        assert await store(database).load(session, "alpha-queued") is not None
    async with database.sessions() as session:
        assert await store(database).load(session, "absent") is None
        assert "allow_system_reads" not in session.info and "owner_user_id" not in session.info
        task = await store(database).load(session, "beta-queued")
        assert task.owner_user_id == session.info["owner_user_id"] == "beta"
        assert "allow_system_reads" not in session.info
    async with database.sessions(info={"allow_system_reads": False}) as session:
        assert await store(database).load(session, "alpha-queued") is not None
        assert session.info["allow_system_reads"] is False


async def test_system_enumeration_is_read_only_and_active_polling_spans_owned_accounts(database):
    tasks = await store(database).active_task_ids(statuses=("queued",))
    assert set(tasks) == {"alpha-queued", "beta-queued"}
    async with database.sessions(info={"allow_system_reads": True}) as session:
        row = await session.get(ModelInferenceTask, "alpha-queued")
        row.status = "failed"
        with pytest.raises(ServiceStorageError, match="缺少账号"):
            await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelInferenceTask, "alpha-queued")).status == "queued"


async def test_generation_recovery_commits_each_account_and_resumes_without_repeating_logs(
    database,
):
    observed = []

    def terminal(session, row):
        observed.append((session.info["owner_user_id"], row.owner_user_id))
        session.add(
            LlmCallLog(
                owner_user_id=row.owner_user_id,
                call_source="model_inference",
                provider_kind=row.provider_kind,
                model=row.model_slug,
                trace_id=row.id,
                status="error",
            )
        )

    tasks = store(database, terminal_hook=terminal)

    def interrupted(**options):
        if options.get("info", {}).get("owner_user_id") == "beta":
            raise RuntimeError("restart between accounts")
        return database.sessions(**options)

    tasks.session_factory = interrupted
    with pytest.raises(RuntimeError, match="restart between accounts"):
        await tasks.recover_submitting()
    tasks.session_factory = database.sessions
    await tasks.recover_submitting()
    await tasks.recover_submitting()
    assert observed == [("alpha", "alpha"), ("beta", "beta")]
    for owner in ("alpha", "beta"):
        async with database.sessions(info={"owner_user_id": owner}) as session:
            rows = list(await session.scalars(select(ModelInferenceTask)))
            assert {row.id: row.status for row in rows} == {
                f"{owner}-queued": "queued",
                f"{owner}-submitting": "failed",
                f"{owner}-pending": "pending",
                f"{owner}-completed": "completed",
            }
            failed = next(row for row in rows if row.status == "failed")
            assert failed.revision == 1 and "避免重复计费" in failed.error_message
            logs = list(await session.scalars(select(LlmCallLog)))
            assert len(logs) == 1 and logs[0].trace_id == failed.id


async def test_concurrent_runner_claims_submit_once_and_settle_only_the_owned_task(database):
    tasks = store(database)
    submitted, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def submit(task):
        calls.append((task.task_id, task.owner_user_id))
        submitted.set()
        await release.wait()
        return "upstream-one"

    async def unexpected(*_args):
        raise AssertionError("No polling or materialization during supplier submission")

    driver = GenerationTaskDriver(
        store=tasks, submit=submit, poll=unexpected, materialize=unexpected, map_error=str
    )
    first = asyncio.create_task(driver.process("alpha-queued"))
    try:
        await asyncio.wait_for(submitted.wait(), 3)
        await driver.process("alpha-queued")
    finally:
        release.set()
        await first
    assert calls == [("alpha-queued", "alpha")]
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        task = await tasks.load(session, "alpha-queued")
        assert task.status == "pending" and task.provider_task_id == "upstream-one"
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        assert (await tasks.load(session, "beta-queued")).status == "queued"


async def test_transcription_recovery_uses_scoped_writes_and_never_resubmits(database):
    runner = ModelTestTranscriptionRunner(
        database.sessions,
        decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
        settings=isolated_settings(),
    )
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        assert await runner._load_task(session, "transcription-alpha") is None
        assert session.info["owner_user_id"] == "beta"
    await runner.recover()
    await runner.recover()
    for owner in ("alpha", "beta"):
        async with database.sessions(info={"owner_user_id": owner}) as session:
            row = await load_runner_task(
                session, ModelTestTranscriptionTask, "transcription-" + owner, subject="fixture"
            )
            assert row.status == "failed" and row.revision == 1
            assert row.completed_at is not None and "避免重复计费" in row.error_message
            logs = list(await session.scalars(select(LlmCallLog)))
            assert len(logs) == 1 and logs[0].owner_user_id == owner


async def test_inference_recovery_and_settlement_need_no_identity_database(database, tmp_path):
    from studio.apps.model_service.inference.runner import InferenceRunner

    runner = InferenceRunner(
        database.sessions,
        settings=SimpleNamespace(runtime_path=tmp_path),
        decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
    )
    for owner in ("alpha", "beta"):
        root = runner.storage.root(owner)
        (root / "inputs").mkdir(parents=True)
        (root / "outputs").mkdir()
        (root / "inputs/kept-input").write_bytes(b"input")
        (root / "outputs/kept-output").write_bytes(b"output")
        (root / "inputs/uncommitted-input").write_bytes(b"incomplete")
        (root / "outputs/uncommitted-output").write_bytes(b"incomplete")
        async with database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(ModelInferenceTask, f"{owner}-completed")
            row.result_storage_key = "kept-output"
            session.add(
                ModelInferenceAsset(
                    id="input-" + owner,
                    owner_user_id=owner,
                    task_id=f"{owner}-queued",
                    storage_key="kept-input",
                    filename="fixture.png",
                    mime_type="image/png",
                    media_kind="image",
                    byte_size=5,
                )
            )
            await session.commit()
    unrelated = tmp_path / "accounts/alpha/thought-workshop/original"
    unrelated.parent.mkdir()
    unrelated.write_bytes(b"unique original")
    unrecorded = runner.storage.root("not-in-the-database") / "inputs"
    unrecorded.mkdir(parents=True)
    (unrecorded / "interrupted-upload").write_bytes(b"no committed row")
    await runner.recover()
    await runner.recover()
    assert unrelated.read_bytes() == b"unique original"
    assert not list(unrecorded.iterdir())
    for owner in ("alpha", "beta"):
        root = runner.storage.root(owner)
        assert {p.name for p in (root / "inputs").iterdir()} == {"kept-input"}
        assert {p.name for p in (root / "outputs").iterdir()} == {"kept-output"}
    context = await runner.store.claim("alpha-queued")
    assert set(await runner.inputs(context)) == {"input-alpha"}
    assert await runner.finish(
        "alpha-queued", "settled", "result.png", "image/png", 10, {"ok": True}
    )
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await runner.store.load(session, "alpha-queued")
        assert row.status == "completed" and row.result_storage_key == "settled"
        logs = list(await session.scalars(select(LlmCallLog)))
        assert {log.trace_id for log in logs} == {"alpha-submitting", "alpha-queued"}
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        assert (await runner.store.load(session, "beta-queued")).status == "queued"


def test_inference_file_recovery_does_not_follow_links_or_remove_other_kinds(tmp_path):
    from studio.apps.model_service.inference.storage import InferenceStorage

    storage = InferenceStorage(SimpleNamespace(runtime_path=tmp_path / "models"))
    external = tmp_path / "other-service"
    external.mkdir()
    original = external / "original"
    original.write_bytes(b"must remain")
    root = storage.root("alpha")
    (root / "inputs").mkdir(parents=True)
    (root / "inputs/original-link").symlink_to(original)
    (root / "inputs/subdirectory").mkdir()
    (root / "inputs/uncommitted").write_bytes(b"orphan")
    (storage.accounts_root / "linked-account").symlink_to(external, target_is_directory=True)
    storage.cleanup_uncommitted(set(), set())
    assert original.read_bytes() == b"must remain"
    assert (root / "inputs/original-link").is_symlink()
    assert (root / "inputs/subdirectory").is_dir()
    assert not (root / "inputs/uncommitted").exists()
    with pytest.raises(ValueError, match="symbolic links"):
        storage.root("linked-account")
    (root / "outputs").symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        storage.cleanup_uncommitted(set(), set())
    assert original.read_bytes() == b"must remain"
    for owner in ("..", "../alpha", "alpha/../beta", ""):
        with pytest.raises(ValueError, match="invalid account"):
            storage.root(owner)
