"""Native delivery bytes are retired only behind a durable application fence."""

import asyncio
import json
from dataclasses import asdict

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tests import test_native_models
from tests.test_native_models import recording, stop, task

from studio.apps.model_service.inference.tasks import InferenceTasks
from studio.apps.model_service.local_models.native_files import accept_result
from studio.apps.model_service.storage.models.model_inference import ModelInferenceTask
from studio.apps.model_service.storage.native_records import NativeModelJob, NativeModelProof
from studio.apps.model_service.storage.service_models import TaskAuthorization
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.host.receipts import ReceiptStore
from studio.runtime.files.signed_payloads import ModelOutputDescription

native_case = test_native_models.case


@pytest.fixture
async def completed(native_case):
    case = native_case
    task_id = await task(case)
    worker = asyncio.create_task(case.worker.run())
    try:
        await case.inference.synthesize(task_id)
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            job = await session.scalar(select(NativeModelJob))
            lease = NativeLease(
                job_id=job.id,
                lease_id=job.lease_id,
                owner_user_id=job.owner_user_id,
                operation=job.operation,
                payload=dict(job.payload),
                lease_expires_at=job.lease_expires_at.isoformat(),
            )
            outcome = NativeOutcome(
                status=job.status, result=job.result, error_code=job.error_code, message=job.message
            )
            description = ModelOutputDescription(**job.output_descriptor)
            output = case.broker.storage.root("alpha") / "outputs" / row.result_storage_key
        yield case, task_id, lease, outcome, description, output
    finally:
        await stop(worker)


async def test_applied_result_removes_hidden_copy_and_late_upload_cannot_recreate(completed):
    case, task_id, lease, outcome, description, output = completed
    artifact = case.broker.artifact(str(lease.job_id), description.content_sha256)
    assert artifact.read_bytes() == recording()
    await case.broker.retention.cleanup()
    assert artifact.is_file()  # The only durable application decision is still absent.
    await case.broker.process_once()
    await case.broker.retention.cleanup()
    assert not artifact.exists() and output.read_bytes() == recording()
    await case.transport.upload_result(lease, output, asdict(description))
    acknowledged = await case.transport.post(
        "receipt",
        {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
    )
    assert acknowledged["acknowledged"] is True and not artifact.exists()
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        job = await session.get(NativeModelJob, str(lease.job_id))
        assert job.applied_at is not None and job.artifacts_removed_at is not None
    assert case.runtime.calls == 1


async def test_upload_started_before_delete_cannot_republish_or_restore_sensitive_text(
    completed,
):
    case, task_id, lease, outcome, description, output = completed
    artifact = case.broker.artifact(str(lease.job_id), description.content_sha256)
    artifact.unlink()  # Exercise a real in-flight re-upload rather than its fast receipt path.
    streaming, release = asyncio.Event(), asyncio.Event()

    async def chunks():
        yield recording()[:100]
        streaming.set()
        await release.wait()
        yield recording()[100:]

    uploading = asyncio.create_task(
        accept_result(
            case.broker, "fixture", str(lease.job_id), str(lease.lease_id), description, chunks()
        )
    )
    try:
        await asyncio.wait_for(streaming.wait(), 3)
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            await InferenceTasks(
                session, "alpha", settings=case.settings, native_retention=case.broker.retention
            ).delete(task_id, row.revision)
        assert not output.exists()
        release.set()
        assert await asyncio.wait_for(uploading, 3) == {"stored": True}
        assert not artifact.exists() and not artifact.parent.exists()
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            job = await session.get(NativeModelJob, str(lease.job_id))
            proof = await session.get(NativeModelProof, job.id)
            assert job.retired_at is not None and job.payload == {} and proof.assertion == ""
            assert await session.get(TaskAuthorization, ("inference", task_id)) is None
        response = await case.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        assert response["acknowledged"] is True
        await case.broker.recover()
        assert not artifact.exists() and case.runtime.calls == 1
    finally:
        release.set()
        await asyncio.gather(uploading, return_exceptions=True)


@pytest.mark.parametrize("committed", [False, True])
async def test_application_commit_failure_keeps_unique_native_bytes_until_confirmed(
    completed, monkeypatch, committed
):
    case, task_id, lease, _outcome, description, output = completed
    artifact = case.broker.artifact(str(lease.job_id), description.content_sha256)
    original = AsyncSession.commit
    injected = False

    async def failing(session):
        nonlocal injected
        marking = any(
            isinstance(row, NativeModelJob) and row.applied_at is not None for row in session.dirty
        )
        if marking and not injected:
            injected = True
            if committed:
                await original(session)
            raise OSError("synthetic application decision acknowledgement lost")
        return await original(session)

    monkeypatch.setattr(AsyncSession, "commit", failing)
    with pytest.raises(OSError):
        await case.broker.process_once()
    assert artifact.is_file() and output.is_file()
    await case.broker.recover()
    assert artifact.exists() is (not committed)
    assert output.read_bytes() == recording() and case.runtime.calls == 1
    if not committed:
        await case.broker.process_once()
        await case.broker.retention.cleanup()
        assert not artifact.exists()


def test_model_acknowledged_receipts_forget_text_but_preserve_unknown_and_replay(tmp_path):
    lease = NativeLease(
        job_id="00000000-0000-4000-8000-000000000001",
        lease_id="00000000-0000-4000-8000-000000000002",
        owner_user_id="alpha",
        operation="models.synthesize",
        payload={"text": "private text", "reference_text": "private reference"},
        lease_expires_at="2099-01-01T00:00:00",
    )
    old = ReceiptStore(tmp_path)
    result = old.execute(lease, lambda *_args: {"ok": True})
    old.acknowledge(lease)
    receipts = ReceiptStore(tmp_path, retain_acknowledged_payload=False)
    document = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert document["lease"]["payload"] == {}
    assert receipts.execute(lease, lambda *_args: pytest.fail("must not execute again")) == result
    assert not list(receipts.pending())


@pytest.mark.parametrize("committed", [False, True])
async def test_delete_commit_unknown_recovers_only_confirmed_retirement(
    completed, monkeypatch, committed
):
    case, task_id, lease, _outcome, description, output = completed
    artifact = case.broker.artifact(str(lease.job_id), description.content_sha256)
    original = AsyncSession.commit
    injected, deleting_session = False, None

    async def uncertain(session):
        nonlocal injected
        if session is deleting_session and not injected:
            injected = True
            if committed:
                await original(session)
            raise OSError("synthetic delete acknowledgement lost")
        return await original(session)

    monkeypatch.setattr(AsyncSession, "commit", uncertain)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        deleting_session = session
        row = await session.get(ModelInferenceTask, task_id)
        with pytest.raises(OSError):
            await InferenceTasks(
                session, "alpha", settings=case.settings, native_retention=case.broker.retention
            ).delete(task_id, row.revision)
    assert artifact.exists() and output.exists()
    await case.broker.recover()
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceTask, task_id)
        job = await session.get(NativeModelJob, str(lease.job_id))
        assert (row is None) is committed
        assert (job.payload == {}) is committed
    if committed:
        assert not artifact.exists()
        await case.inference.recover()
        assert not output.exists()
    else:
        assert artifact.read_bytes() == output.read_bytes() == recording()
    assert case.runtime.calls == 1


async def test_cleanup_failure_retains_durable_pending_work_for_restart(completed, monkeypatch):
    from pathlib import Path

    case, _task_id, lease, _outcome, description, output = completed
    artifact = case.broker.artifact(str(lease.job_id), description.content_sha256)
    await case.broker.process_once()
    original, failed = Path.unlink, False

    def denied_once(path, *args, **kwargs):
        nonlocal failed
        if path == artifact and not failed:
            failed = True
            raise PermissionError("synthetic cleanup failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", denied_once)
    with pytest.raises(PermissionError):
        await case.broker.retention.cleanup()
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        job = await session.get(NativeModelJob, str(lease.job_id))
        assert job.applied_at is not None and job.artifacts_removed_at is None
    assert artifact.is_file() and output.is_file()
    await case.broker.recover()
    assert not artifact.exists() and output.read_bytes() == recording()
