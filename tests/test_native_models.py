"""A synthetic Mac executes real lease/byte/receipt protocols against owned Models SQLite."""

import asyncio
import hashlib
import io
import os
import subprocess
import sys
import wave
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from sqlalchemy import select

from app.llm.inference.runner import InferenceRunner
from app.llm.local_models.authorization import LocalModelActionAuthorization
from app.llm.models import (
    LocalModelInstallation,
    ModelEntry,
    ModelInferenceAsset,
    ModelInferenceTask,
    ModelProvider,
)
from app.llm.task_outcomes import SUBMISSION_INTERRUPTED_MESSAGE
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.native_models import NativeModelBroker
from studio.apps.model_service.storage.native_records import NativeModelJob
from studio.apps.model_service.storage.service_models import (
    ACCOUNT_MODELS,
    MODELS,
    TaskAuthorization,
)
from studio.apps.model_service.storage.task_records import task_fingerprint
from studio.apps.model_service.transport.native_api import attach_native
from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.model_service.schemas.local_models import LocalModelActionIn
from studio.host.local_models.models_control import ModelsControl
from studio.host.local_models.models_transport import ModelsTransport
from studio.host.local_models.models_worker import ModelsWorker
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database

MODEL = "qwen3-tts-0.6b-base"


def recording():
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\0\0" * 8000 * 4)
    return output.getvalue()


class Identity:
    active = True

    async def status(self, **_request):
        return self.active


class Installer:
    def __init__(self, root):
        self.root, self.calls = root, 0
        self.python = root / "environment/python"
        self.python.parent.mkdir(parents=True)
        self.python.touch()

    def model_path(self, model_id):
        return self.root / "models" / model_id

    def is_installed(self, model):
        return self.python.is_file() and (self.model_path(model["id"]) / "config.json").is_file()

    async def install(self, model, report, *, repair=False):
        self.calls += 1
        assert repair in {True, False}
        folder = self.model_path(model["id"])
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "config.json").write_text("{}")
        await report(100)


class Runtime:
    def __init__(self):
        self.model_id, self.process = None, None
        self.busy, self.maintenance, self.calls = False, False, 0
        self.control = asyncio.Lock()
        self.started, self.release = asyncio.Event(), asyncio.Event()
        self.release.set()

    async def synthesize(self, model_id, payload, validate):
        await validate()
        self.calls += 1
        self.started.set()
        self.busy = True
        await self.release.wait()
        assert model_id == MODEL
        Path(payload["output_path"]).write_bytes(Path(payload["reference_path"]).read_bytes())
        self.busy = False
        return {"ok": True, "elapsed_seconds": 0.01}

    async def close(self):
        self.model_id, self.process = None, None


async def until(predicate, timeout=5):
    async def wait():
        while not await predicate():
            await asyncio.sleep(0.02)

    await asyncio.wait_for(wait(), timeout)


@pytest.fixture
async def case(tmp_path):
    state = tmp_path / "models"
    apply(state / "service.db", "models", MIGRATIONS)
    database = Database("models", state, models=MODELS, account_models=ACCOUNT_MODELS)
    settings = SimpleNamespace(
        runtime_path=state,
        database_path=state / "service.db",
        fpl_visual_asset_max_bytes=2 * 1024**2,
    )
    key, identity = Ed25519PrivateKey.generate(), Identity()
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    broker = NativeModelBroker(database, settings, identity, key.public_key(), catalog)
    inference = InferenceRunner(
        database.sessions,
        local_runtime=broker,
        settings=settings,
        synthesis_scope=broker.foreground_synthesis,
    )
    broker.connect_inference(inference)
    app = FastAPI()
    ingress, credential = "synthetic-models-ingress-" * 3, "synthetic-models-worker-" * 3
    attach_native(app, broker, ingress_token=ingress, workers={"fixture": credential})

    class Routing(httpx.AsyncBaseTransport):
        lose_receipt = False
        receipts = 0

        async def handle_async_request(self, request):
            path = request.url.path.removeprefix("/models")
            request.url = request.url.copy_with(path=path)
            # Mirror the trusted native gateway: client identity markers are removed.
            # Byte metadata must survive without sharing their reserved namespace.
            for header in tuple(request.headers):
                if header.lower().startswith("x-fpl-"):
                    del request.headers[header]
            request.headers["x-fpl-native-ingress"] = ingress
            response = await httpx.ASGITransport(app=app).handle_async_request(request)
            if path == "/_native/v1/receipt":
                self.receipts += 1
                if self.lose_receipt:
                    self.lose_receipt = False
                    await response.aread()
                    await response.aclose()
                    raise httpx.ReadError("synthetic lost receipt response", request=request)
            return response

    transport = ModelsTransport(
        base_url="http://127.0.0.1:29090/models", credential=credential, transport=Routing()
    )
    installer, runtime = Installer(tmp_path / "host-models"), Runtime()
    await installer.install({"id": MODEL}, lambda _progress: asyncio.sleep(0))
    control = ModelsControl(
        tmp_path / "host",
        installer.root,
        installer=installer,
        runtime=runtime,
        compatible_check=lambda: True,
    )
    worker = ModelsWorker(transport, control, tmp_path / "host")
    await broker.report("fixture", await control.observe())
    async with database.sessions() as session:
        session.add(
            LocalModelInstallation(
                id=MODEL, status="installed", enabled=True, progress=100, revision=1
            )
        )
        await session.commit()
    value = SimpleNamespace(
        database=database,
        settings=settings,
        key=key,
        identity=identity,
        catalog=catalog,
        broker=broker,
        inference=inference,
        app=app,
        ingress=ingress,
        transport=transport,
        worker=worker,
        control=control,
        runtime=runtime,
        installer=installer,
        root=tmp_path,
    )
    try:
        yield value
    finally:
        await inference.stop()
        await broker.close()
        await control.close()
        await transport.close()
        await database.close()


def assertion(case, *, path, owner="alpha", role="user", local=False):
    return issue_context(
        Actor(
            owner,
            role,
            "session",
            ("studio:read", "studio:private_read", "studio:write"),
            session_id="fixture-session",
            local=local,
        ),
        service="models",
        method="POST",
        path=path,
        private_key=case.key,
        key_id="fixture",
    )


async def task(case):
    task_id, asset_id = str(uuid4()), str(uuid4())
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        provider = await session.get(ModelProvider, "provider")
        if provider is None:
            session.add(
                ModelProvider(
                    id="provider",
                    owner_user_id="alpha",
                    kind="local_qwen_tts",
                    name="local",
                    base_url="",
                    api_key_ciphertext="",
                    enabled=True,
                )
            )
            await session.flush()
            session.add(
                ModelEntry(
                    id="model",
                    owner_user_id="alpha",
                    provider_id="provider",
                    slug=MODEL,
                    capabilities=["speech_synthesis"],
                    enabled=True,
                )
            )
            await session.flush()
        row = ModelInferenceTask(
            id=task_id,
            owner_user_id="alpha",
            model_id="model",
            provider_id="provider",
            provider_kind="local_qwen_tts",
            provider_name="local",
            model_slug=MODEL,
            kind="speech_synthesis",
            request_id=str(uuid4()),
            fingerprint="body-fingerprint",
            status="queued",
            request_payload={
                "text": "测试合成",
                "language": "Chinese",
                "reference_text": "测试录音",
                "reference_asset_id": asset_id,
                "asset_ids": [asset_id],
            },
        )
        session.add(row)
        await session.flush()
        session.add(
            ModelInferenceAsset(
                id=asset_id,
                owner_user_id="alpha",
                task_id=task_id,
                filename="录音.wav",
                storage_key=asset_id,
                media_kind="audio",
                mime_type="audio/wav",
                byte_size=len(recording()),
            )
        )
        session.add(
            TaskAuthorization(
                kind="inference",
                task_id=task_id,
                owner_user_id="alpha",
                fingerprint=task_fingerprint("inference", row),
                source_method="POST",
                source_path="/v1/model-inference/tasks",
                assertion=assertion(case, path="/v1/model-inference/tasks"),
            )
        )
        await session.commit()
    root = case.broker.storage.root("alpha") / "inputs"
    root.mkdir(parents=True, exist_ok=True)
    (root / asset_id).write_bytes(recording())
    return task_id


async def stop(worker_task):
    worker_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await worker_task


async def test_complete_synthesis_uses_exact_bytes_and_only_path_free_leases(case):
    task_id = await task(case)
    worker = asyncio.create_task(case.worker.run())
    try:
        await case.inference.synthesize(task_id)
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            assert row.status == "completed", row.error_message
            output = case.broker.storage.root("alpha") / "outputs" / row.result_storage_key
            assert output.read_bytes() == recording()
            job = await session.scalar(select(NativeModelJob))
            assert not any("path" in key for key in job.payload)
            assert "assertion" not in job.payload
            assert str(case.root) not in str(job.payload)
        assert case.runtime.calls == 1
    finally:
        await stop(worker)


async def test_lost_receipt_response_replays_saved_output_without_model_resubmission(case):
    task_id = await task(case)
    case.transport.client._transport.lose_receipt = True
    worker = asyncio.create_task(case.worker.run())
    try:
        await case.inference.synthesize(task_id)

        async def acknowledged():
            return not list(case.worker.receipts.pending())

        await until(acknowledged)
        assert case.runtime.calls == 1
        assert case.transport.client._transport.receipts >= 2
    finally:
        await stop(worker)


async def test_models_restart_settles_original_native_job_and_never_reruns(case):
    task_id = await task(case)
    case.runtime.release.clear()
    worker = asyncio.create_task(case.worker.run())
    execution = asyncio.create_task(case.inference.synthesize(task_id))
    try:
        await asyncio.wait_for(case.runtime.started.wait(), 5)
        execution.cancel()
        with pytest.raises(asyncio.CancelledError):
            await execution
        await case.inference.store.recover_submitting()
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            assert row.status == "failed" and row.error_message == SUBMISSION_INTERRUPTED_MESSAGE
        restarted = NativeModelBroker(
            case.database, case.settings, case.identity, case.key.public_key(), case.catalog
        )
        replacement = InferenceRunner(
            case.database.sessions,
            local_runtime=restarted,
            settings=case.settings,
            synthesis_scope=restarted.foreground_synthesis,
        )
        restarted.connect_inference(replacement)
        case.app.state.native_models = restarted
        case.runtime.release.set()

        async def completed():
            await restarted.process_once()
            async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
                return (await session.get(ModelInferenceTask, task_id)).status == "completed"

        await until(completed)
        assert case.runtime.calls == 1
        await replacement.stop()
        await restarted.close()
    finally:
        case.runtime.release.set()
        await stop(worker)


async def test_revoked_request_cannot_start_native_synthesis(case):
    task_id = await task(case)
    execution = asyncio.create_task(case.inference.synthesize(task_id))

    async def queued():
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            return await session.scalar(select(NativeModelJob.id)) is not None

    await until(queued)
    case.identity.active = False
    worker = asyncio.create_task(case.worker.run())
    try:
        await asyncio.wait_for(execution, 5)
        await case.broker.process_once()
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            assert row.status == "failed" and row.error_message != SUBMISSION_INTERRUPTED_MESSAGE
        assert case.runtime.calls == 0
    finally:
        await stop(worker)


async def test_admin_action_preserves_cas_and_original_request_authority(case):
    model_path = "/v1/platform/local-models/" + MODEL + "/actions"
    authorization = LocalModelActionAuthorization(
        "alpha", assertion(case, path=model_path, role="admin", local=True), "POST", model_path
    )
    body = LocalModelActionIn(request_id="stop-once", expected_revision=1, action="stop")
    first = await case.broker.action(MODEL, body, authorization=authorization)
    repeated = await case.broker.action(MODEL, body, authorization=authorization)
    assert first == repeated and not first.enabled and first.revision == 2
    worker = asyncio.create_task(case.worker.run())
    try:

        async def applied():
            await case.broker.process_once()
            async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
                job = await session.scalar(select(NativeModelJob))
                return job.applied_at is not None

        await until(applied)
        async with case.database.sessions() as session:
            row = await session.get(LocalModelInstallation, MODEL)
            assert row.status == "installed" and not row.enabled
    finally:
        await stop(worker)


async def test_public_or_wrong_purpose_native_management_is_rejected(case):
    from studio.runtime.database.operation_receipts import OperationError

    path = "/v1/platform/local-models/" + MODEL + "/actions"
    body = LocalModelActionIn(request_id="never-run", expected_revision=1, action="uninstall")
    remote = LocalModelActionAuthorization(
        "alpha", assertion(case, path=path, role="admin"), "POST", path
    )
    with pytest.raises(OperationError) as denied:
        await case.broker.action(MODEL, body, authorization=remote)
    assert denied.value.status == 403 and case.installer.model_path(MODEL).exists()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=case.app), base_url="http://models"
    ) as browser:
        response = await browser.post("/_native/v1/claim", json={"wait_seconds": 0})
        assert response.status_code == 403
    assert not case.app.openapi()["paths"]


def test_native_mac_modules_do_not_import_service_orm_or_database(tmp_path):
    code = """
import sys
import studio.host.local_models.models_worker
for name in ('studio.runtime.database.website',
    'app.llm.models',
    'studio.apps.model_service.storage.service_models',
    'app.console.models.accounts'):
    assert name not in sys.modules, name
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=30,
        env={
            **os.environ,
            "PYTHONPATH": str(Path("backend").resolve()),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "FPL_DATABASE_PATH": str(tmp_path / "unused.db"),
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("parent", ["models", "staging"])
async def test_uninstall_refuses_linked_parent_and_keeps_external_files(case, parent):
    outside = case.root / "outside"
    outside.mkdir()
    model = outside / MODEL
    model.mkdir()
    marker = model / "precious-original"
    marker.write_text("keep")
    location = case.installer.root / parent
    if location.exists():
        location.rename(location.with_name("saved-" + parent))
    location.symlink_to(outside, target_is_directory=True)
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="alpha",
        operation="models.uninstall",
        payload={"model_id": MODEL, "action": "uninstall", "target_revision": 2},
        lease_expires_at="2099-01-01T00:00:00",
    )
    with pytest.raises(ValueError, match="链接"):
        await case.control.execute(lease, lambda: asyncio.sleep(0))
    assert marker.read_text() == "keep"


async def test_cleanup_refuses_linked_jobs_parent_and_keeps_external_files(case):
    outside = case.root / "outside-jobs"
    outside.mkdir()
    job_id = uuid4()
    job = outside / str(job_id)
    job.mkdir()
    original = job / "result.wav"
    original.write_bytes(recording())
    (case.control.root / "jobs").symlink_to(outside, target_is_directory=True)
    lease = NativeLease(
        job_id=job_id,
        lease_id=uuid4(),
        owner_user_id="alpha",
        operation="models.synthesize",
        payload={},
        lease_expires_at="2099-01-01T00:00:00",
    )
    with pytest.raises(ValueError, match="链接"):
        await case.control.cleanup(lease)
    assert original.read_bytes() == recording()


def test_installer_readiness_requires_every_pinned_file_and_completed_environment(tmp_path):
    from app.llm.local_models.installer import Installer as RealInstaller

    installer = RealInstaller(tmp_path)
    model = {
        "id": MODEL,
        "files": [
            {"path": "config.json", "size": 2, "sha256": hashlib.sha256(b"{}").hexdigest()},
            {
                "path": "weights.safetensors",
                "size": 4,
                "sha256": hashlib.sha256(b"1234").hexdigest(),
            },
        ],
    }
    installer.python.parent.mkdir(parents=True)
    installer.python.touch()
    root = installer.model_path(MODEL)
    root.mkdir(parents=True)
    (root / "config.json").write_text("{}")
    assert not installer.is_installed(model)
    (root / "weights.safetensors").write_bytes(b"1234")
    assert not installer.is_installed(model)
    (installer.python.parents[2] / "ready").write_text("1")
    assert installer.is_installed(model)
    (root / "weights.safetensors").write_bytes(b"5678")
    assert not installer.is_installed(model)
    (root / "weights.safetensors").write_bytes(b"truncated")
    assert not installer.is_installed(model)


async def test_worker_recovered_intent_never_repeats_an_unknown_execution(case):
    task_id = await task(case)
    execution = asyncio.create_task(case.inference.synthesize(task_id))

    async def queued():
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            return await session.scalar(select(NativeModelJob.id)) is not None

    await until(queued)
    lease = NativeLease.model_validate(
        (await case.transport.post("claim", {"wait_seconds": 0}))["lease"]
    )

    def interrupted(_operation, _payload):
        raise SystemExit("synthetic power loss")

    with pytest.raises(SystemExit):
        case.worker.receipts.execute(lease, interrupted)
    assert list(case.worker.receipts.pending())[0][1] is None
    worker = asyncio.create_task(case.worker.run())
    try:
        await asyncio.wait_for(execution, 5)
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            job = await session.get(NativeModelJob, str(lease.job_id))
            row = await session.get(ModelInferenceTask, task_id)
            assert job.status == "unknown" and row.status == "submitting"
        assert case.runtime.calls == 0
        assert (await case.transport.post("claim", {"wait_seconds": 0}))["lease"] is None
    finally:
        await stop(worker)


async def test_identity_unavailable_defers_the_same_lease_before_execution(case):
    task_id = await task(case)
    case.identity.active = None
    execution = asyncio.create_task(case.inference.synthesize(task_id))
    worker = asyncio.create_task(case.worker.run())
    try:

        async def leased():
            async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
                return (
                    await session.scalar(
                        select(NativeModelJob.id).where(NativeModelJob.status == "leased")
                    )
                    is not None
                )

        await until(leased)
        await asyncio.sleep(0.05)
        assert case.runtime.calls == 0
        case.identity.active = True
        await asyncio.wait_for(execution, 5)
        assert case.runtime.calls == 1
    finally:
        case.identity.active = True
        await stop(worker)


async def test_already_accepted_native_job_finishes_original_result_after_logout(case):
    task_id = await task(case)
    case.runtime.release.clear()
    worker = asyncio.create_task(case.worker.run())
    execution = asyncio.create_task(case.inference.synthesize(task_id))
    try:
        await asyncio.wait_for(case.runtime.started.wait(), 5)
        case.identity.active = False
        case.runtime.release.set()
        await asyncio.wait_for(execution, 5)
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            assert row.status == "completed"
        assert case.runtime.calls == 1
    finally:
        case.runtime.release.set()
        await stop(worker)


async def test_old_command_receipt_cannot_override_newer_enabled_state(case):
    path = "/v1/platform/local-models/" + MODEL + "/actions"
    authorization = LocalModelActionAuthorization(
        "alpha", assertion(case, path=path, role="admin", local=True), "POST", path
    )
    await case.broker.action(
        MODEL,
        LocalModelActionIn(request_id="old-stop", expected_revision=1, action="stop"),
        authorization=authorization,
    )
    await case.broker.action(
        MODEL,
        LocalModelActionIn(request_id="new-enable", expected_revision=2, action="enable"),
        authorization=authorization,
    )
    worker = asyncio.create_task(case.worker.run())
    try:

        async def finished():
            await case.broker.process_once()
            async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
                jobs = list(await session.scalars(select(NativeModelJob)))
                return len(jobs) == 2 and all(job.applied_at is not None for job in jobs)

        await until(finished)
        async with case.database.sessions() as session:
            row = await session.get(LocalModelInstallation, MODEL)
            assert row.status == "installed" and row.enabled
    finally:
        await stop(worker)


async def test_repair_preserves_explicitly_disabled_model(case):
    async with case.database.sessions() as session:
        row = await session.get(LocalModelInstallation, MODEL)
        row.enabled = False
        await session.commit()
    path = "/v1/platform/local-models/" + MODEL + "/actions"
    authorization = LocalModelActionAuthorization(
        "alpha", assertion(case, path=path, role="admin", local=True), "POST", path
    )
    await case.broker.action(
        MODEL,
        LocalModelActionIn(request_id="repair-disabled", expected_revision=1, action="repair"),
        authorization=authorization,
    )
    worker = asyncio.create_task(case.worker.run())
    try:

        async def finished():
            await case.broker.process_once()
            async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
                row = await session.get(LocalModelInstallation, MODEL)
                return row.status == "installed"

        await until(finished)
        async with case.database.sessions() as session:
            assert (await session.get(LocalModelInstallation, MODEL)).enabled is False
    finally:
        await stop(worker)


async def test_uncertain_native_submission_cannot_delete_original_task_or_input(case):
    from app.llm.inference.tasks import InferenceTasks
    from studio.runtime.database.operation_receipts import OperationError

    task_id = await task(case)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceTask, task_id)
        row.status, row.error_message = "failed", SUBMISSION_INTERRUPTED_MESSAGE
        await session.commit()
        with pytest.raises(OperationError) as unresolved:
            await InferenceTasks(session, "alpha").delete(task_id, row.revision)
        assert unresolved.value.status == 409
        assert await session.get(ModelInferenceTask, task_id) is not None
        asset = await session.scalar(
            select(ModelInferenceAsset).where(ModelInferenceAsset.task_id == task_id)
        )
        assert (
            case.broker.storage.root("alpha") / "inputs" / asset.storage_key
        ).read_bytes() == recording()


async def test_command_receipt_waits_for_fresh_observation_after_older_report(tmp_path):
    """A report sampled before installation cannot arrive after completion."""
    from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome

    old_report_started, release_old_report = asyncio.Event(), asyncio.Event()
    deliveries = []

    class Control:
        installed = False

        async def observe(self):
            return {"installed": self.installed}

        async def cleanup(self, _lease):
            pass

    class Transport:
        async def post(self, operation, payload):
            if operation == "report" and not payload["installed"]:
                old_report_started.set()
                await release_old_report.wait()
            deliveries.append((operation, payload))
            return {"acknowledged": True}

    control = Control()
    worker = ModelsWorker(Transport(), control, tmp_path)
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="alpha",
        operation="models.install",
        payload={},
        lease_expires_at="2099-01-01T00:00:00",
    )
    worker.receipts.execute(lease, lambda *_args: {"installed": True})
    observer = asyncio.create_task(worker.report_state())
    await asyncio.wait_for(old_report_started.wait(), 2)
    control.installed = True
    completion = asyncio.create_task(
        worker.deliver(lease, NativeOutcome(status="completed", result={"installed": True}))
    )
    try:
        await asyncio.sleep(0)
        assert not deliveries
        release_old_report.set()
        await asyncio.wait_for(asyncio.gather(observer, completion), 2)
        assert [operation for operation, _payload in deliveries] == ["report", "report", "receipt"]
        assert [
            payload["installed"] for operation, payload in deliveries if operation == "report"
        ] == [False, True]
    finally:
        release_old_report.set()
        await asyncio.gather(observer, completion, return_exceptions=True)


@pytest.mark.parametrize("phase", ["download", "serial", "executing"])
async def test_worker_shutdown_drains_real_action_and_receipt_before_closing(tmp_path, phase):
    """Stopping cannot leave a callback that starts work after the host lock exits."""
    entered, release = asyncio.Event(), asyncio.Event()
    cleanup_started, cleanup_release = asyncio.Event(), asyncio.Event()
    serial = asyncio.Lock()
    if phase == "serial":
        await serial.acquire()
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="alpha",
        operation="models.install" if phase == "serial" else "models.synthesize",
        payload={"reference_filename": "reference.wav"},
        lease_expires_at="2099-01-01T00:00:00",
    )

    class Control:
        active, calls, closed = False, 0, False

        def scratch(self, _lease):
            return tmp_path

        async def observe(self):
            return {}

        async def execute(self, _lease, _authorize):
            self.active = True
            try:
                if phase == "serial":
                    entered.set()
                async with serial:
                    self.calls += 1
                    entered.set()
                    await release.wait()
                    assert not self.closed
                    return {"installed": True}
            finally:
                if phase == "executing":
                    cleanup_started.set()
                    await cleanup_release.wait()
                self.active = False

        async def close(self):
            assert not self.active
            self.closed = True

    class Transport:
        claimed, active, closed = False, False, False

        async def post(self, operation, _body):
            if operation == "claim":
                if not self.claimed:
                    self.claimed = True
                    return {"lease": lease.model_dump(mode="json")}
                return {"lease": None}
            return {"active": True}

        async def download_reference(self, _lease, _target):
            self.active = True
            try:
                if phase == "download":
                    entered.set()
                    await release.wait()
                    assert not self.closed
            finally:
                self.active = False

        async def close(self):
            assert not self.active
            self.closed = True

    control, transport = Control(), Transport()
    worker = ModelsWorker(transport, control, tmp_path)
    running = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(entered.wait(), 3)
        running.cancel()
        if phase == "executing":
            await asyncio.wait_for(cleanup_started.wait(), 3)
            assert not running.done() and not control.closed and not transport.closed
            # Another stop cannot interrupt an already running cleanup barrier.
            for task in tuple(worker.running.values()):
                task.cancel()
            await asyncio.sleep(0)
            assert not running.done() and not control.closed
            cleanup_release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(running, 3)
        assert control.closed and transport.closed
        assert control.calls == (1 if phase == "executing" else 0)
        pending = list(worker.receipts.pending())
        assert len(pending) == 1 and pending[0][1]["status"] == "unknown"
        # Even an explicit repeated execution of the original lease only reads
        # its retained unknown outcome; it cannot dispatch another model action.
        again = await worker.execute(lease)
        assert again.status == "unknown"
        assert control.calls == (1 if phase == "executing" else 0)
        release.set()
        if phase == "serial":
            serial.release()
        await asyncio.sleep(0)
        assert control.calls == (1 if phase == "executing" else 0)
    finally:
        release.set()
        cleanup_release.set()
        if phase == "serial" and serial.locked():
            serial.release()
        if not running.done():
            running.cancel()
        await asyncio.gather(running, return_exceptions=True)


async def test_cancel_before_dispatch_waits_for_durable_unknown_intent(tmp_path, monkeypatch):
    from threading import Event

    publishing, release = Event(), Event()
    calls = []

    class Control:
        async def execute(self, *_args):
            calls.append("unexpected model side effect")
            return {}

    class Transport:
        async def post(self, *_args):
            calls.append("unexpected network dispatch")
            return {"active": True}

    worker = ModelsWorker(Transport(), Control(), tmp_path)
    original = worker.receipts.publish

    def delayed(path, document):
        if document["outcome"] is None:
            publishing.set()
            assert release.wait(timeout=5)
        original(path, document)

    monkeypatch.setattr(worker.receipts, "publish", delayed)
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="alpha",
        operation="models.install",
        payload={},
        lease_expires_at="2099-01-01T00:00:00",
    )
    execution = asyncio.create_task(worker.execute(lease))
    try:
        assert await asyncio.to_thread(publishing.wait, 3)
        execution.cancel()
        await asyncio.sleep(0)
        assert not execution.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(execution, 3)
        pending = list(worker.receipts.pending())
        assert len(pending) == 1 and pending[0][1]["status"] == "unknown"
        assert not calls
        assert (await worker.execute(lease)).status == "unknown"
        assert not calls
    finally:
        release.set()
        await asyncio.gather(execution, return_exceptions=True)


@pytest.mark.parametrize("fault", ["before_commit", "lost_commit_reply"])
async def test_foreground_finish_failure_releases_same_receipt_for_background_settlement(
    case, fault
):
    from app.llm.models import LlmCallLog

    task_id = await task(case)
    original_finish = case.inference.finish
    finishing, release = asyncio.Event(), asyncio.Event()
    finish_calls = 0

    async def flaky_finish(*args):
        nonlocal finish_calls
        finish_calls += 1
        if finish_calls == 1:
            if fault == "lost_commit_reply":
                await original_finish(*args)
            finishing.set()
            await release.wait()
            raise OSError("synthetic finish acknowledgement failure")
        return await original_finish(*args)

    case.inference.finish = flaky_finish
    worker = asyncio.create_task(case.worker.run())
    foreground = asyncio.create_task(case.inference.synthesize(task_id))
    try:
        await asyncio.wait_for(finishing.wait(), 5)
        assert task_id in case.broker.waiting
        await case.broker.process_once()
        # A foreground finish that has not returned owns this task even if its
        # transaction has committed and only the caller acknowledgement is late.
        assert finish_calls == 1
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            job = await session.scalar(select(NativeModelJob))
            assert job.applied_at is None
        release.set()
        await asyncio.wait_for(foreground, 5)
        assert not case.broker.waiting
        for _ in range(3):
            await case.broker.process_once()
        async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelInferenceTask, task_id)
            job = await session.scalar(select(NativeModelJob))
            assert row.status == "completed" and job.applied_at is not None
            assert (
                case.broker.storage.root("alpha") / "outputs" / row.result_storage_key
            ).read_bytes() == recording()
            logs = list(await session.scalars(select(LlmCallLog)))
            assert len(logs) == 1 and logs[0].status == "success"
        assert case.runtime.calls == 1
        assert finish_calls == (2 if fault == "before_commit" else 1)
    finally:
        release.set()
        await asyncio.gather(foreground, return_exceptions=True)
        await stop(worker)
