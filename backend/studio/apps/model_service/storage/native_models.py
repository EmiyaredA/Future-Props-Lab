"""Models owns authorization and durable commands; a Mac owns MLX and model files."""

import asyncio
import contextlib
import hashlib
import json
import shutil
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import jwt
from sqlalchemy import func, select, text, update

from studio.apps.model_service.generation.outcomes import (
    SUBMISSION_INTERRUPTED_MESSAGE,
    NativeSubmissionUncertain,
)
from studio.apps.model_service.inference.storage import InferenceStorage
from studio.apps.model_service.local_models.native_retention import NativeResultRetention
from studio.apps.model_service.storage.models.local_models import (
    LocalModelInstallation,
    LocalModelOperation,
)
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.apps.model_service.storage.native_records import (
    NativeModelJob,
    NativeModelObservation,
    NativeModelProof,
)
from studio.apps.model_service.storage.service_models import TaskAuthorization
from studio.apps.model_service.storage.task_records import task_fingerprint
from studio.config.local_models import definition, manifest
from studio.contracts.identity.claims import verify_context
from studio.contracts.model_service.model_native import (
    OPERATIONS,
    ActionRequest,
    ModelsObservation,
    SpeechRequest,
)
from studio.contracts.model_service.schemas.local_models import LocalModelOut, LocalModelsOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.task_records import load_runner_task
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError, digest
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class NativeModelBroker(PollingTaskRunner):
    runner_name = "native-model-delivery"
    poll_interval_seconds = 1

    def __init__(self, database, settings, identity, public_key, catalog):
        super().__init__()
        self.database, self.settings, self.identity, self.key, self.catalog = (
            database,
            settings,
            identity,
            public_key,
            catalog,
        )
        self.queue = NativeQueue(database, NativeModelJob, operations=OPERATIONS, clock=utc_now)
        self.storage = InferenceStorage(settings)
        self.retention = NativeResultRetention(database, self.artifact)
        self.inference = None
        self.waiting = {}

    @contextmanager
    def foreground_synthesis(self, task_id):
        self.waiting[task_id] = self.waiting.get(task_id, 0) + 1
        try:
            yield
        finally:
            remaining = self.waiting[task_id] - 1
            if remaining:
                self.waiting[task_id] = remaining
            else:
                del self.waiting[task_id]

    def connect_inference(self, inference):
        if inference.synthesis_scope != self.foreground_synthesis:
            raise ValueError("原生合成必须绑定完整前台结算生命周期")
        self.inference = inference

    async def _observation(self, session):
        row = await session.scalar(
            select(NativeModelObservation)
            .order_by(NativeModelObservation.observed_at.desc())
            .limit(1)
        )
        if row is None or not timedelta(0) <= utc_now() - row.observed_at <= timedelta(seconds=10):
            return None
        return ModelsObservation.model_validate(row.payload)

    async def host_compatible(self, session):
        state = await self._observation(session)
        return bool(state and state.compatible)

    async def require_ready(self, session, model_id):
        state = await self._observation(session)
        if state is None:
            raise OperationError(
                "Mac 原生模型工作进程未连接", "native_model_worker_unavailable", 503
            )
        item = next((m for m in state.models if m.model_id == model_id), None)
        row = await session.get(LocalModelInstallation, model_id, populate_existing=True)
        if not state.compatible:
            raise OperationError(
                "本地语音需要受支持的 Apple Silicon Mac", "unsupported_platform", 409
            )
        if (
            not item
            or not item.installed
            or not row
            or row.status != "installed"
            or not row.enabled
        ):
            raise OperationError("本地模型未安装或已停止", "local_model_unavailable", 409)
        return row

    def _output(self, model, row, state):
        item = next((m for m in state.models if m.model_id == model["id"]), None) if state else None
        size = sum(part["size"] for part in model["files"])
        return LocalModelOut(
            id=model["id"],
            label=model["label"],
            repository=model["repository"],
            license=model["license"],
            model_revision=model["revision"],
            download_bytes=size,
            required_disk_bytes=size * 2 + 2 * 1024**3,
            compatible=bool(state and state.compatible),
            status=row.status if row else "not_installed",
            enabled=row.enabled if row else False,
            loaded=bool(item and item.loaded),
            busy=bool(item and item.busy),
            progress=max(
                row.progress if row else 0, item.progress if item and item.installing else 0
            ),
            revision=row.revision if row else 0,
            error_message=(row.error_message if row else None)
            if state
            else "Mac 原生模型工作进程未连接",
        )

    async def list(self, can_manage=False):
        async with self.database.sessions() as session:
            state = await self._observation(session)
            rows = {r.id: r for r in await session.scalars(select(LocalModelInstallation))}
            return LocalModelsOut(
                can_manage=can_manage,
                items=[
                    self._output(model, rows.get(model["id"]), state)
                    for model in manifest()["models"]
                ],
            )

    def _actor(self, proof, *, owner, operation):
        try:
            actor = verify_context(
                proof.assertion,
                service="models",
                method=proof.source_method,
                path=proof.source_path,
                public_key=self.key,
                allow_expired=True,
            )
        except (jwt.InvalidTokenError, ValueError, TypeError):
            raise OperationError("原生操作签名无效", "native_authorization_invalid", 403) from None

        if actor.user_id != owner:
            raise OperationError("原生操作账号不匹配", "native_authorization_invalid", 403)
        if operation != "models.synthesize" and (
            actor.auth_kind != "session"
            or actor.platform_role != "admin"
            or not actor.local
            or actor.purpose not in {"studio", "management"}
        ):
            raise OperationError("仅本机管理员浏览器可管理模型", "local_admin_required", 403)
        if operation == "models.synthesize" and actor.purpose != "studio":
            raise OperationError("模型任务用途无效", "native_authorization_invalid", 403)
        return actor

    async def _active(self, proof, *, owner, operation):
        self._actor(proof, owner=owner, operation=operation)
        active = await self.identity.status(
            assertion=proof.assertion, method=proof.source_method, path=proof.source_path
        )
        if active is not True:
            raise OperationError(
                "原生操作授权已撤销" if active is False else "身份服务暂不可用",
                "native_authorization_revoked" if active is False else "identity_unavailable",
                403 if active is False else 503,
            )

    def _new_job(self, session, *, owner, operation, payload, request_id, proof):
        row = NativeModelJob(
            id=new_id(),
            owner_user_id=owner,
            request_id=request_id,
            operation=operation,
            payload=payload,
            payload_sha256=digest({"operation": operation, "payload": payload}),
        )
        session.add(row)
        session.add(
            NativeModelProof(
                job_id=row.id,
                owner_user_id=owner,
                assertion=proof.assertion,
                source_method=proof.source_method,
                source_path=proof.source_path,
                source_fingerprint=getattr(proof, "source_fingerprint", None),
            )
        )
        return row

    async def action(self, model_id, body, *, authorization=None):
        model = definition(model_id)
        path = "/v1/platform/local-models/" + model_id + "/actions"
        if authorization is None or authorization.method != "POST" or authorization.path != path:
            raise OperationError("原生模型缺少原请求授权", "native_authorization_required", 403)
        from types import SimpleNamespace

        proof = SimpleNamespace(
            assertion=authorization.assertion, source_method="POST", source_path=path
        )
        await self._active(
            proof, owner=authorization.owner_user_id, operation="models." + body.action
        )
        fingerprint = hashlib.sha256(
            json.dumps(body.model_dump(), sort_keys=True).encode()
        ).hexdigest()
        async with self.database.sessions(
            info={"owner_user_id": authorization.owner_user_id}
        ) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.get(LocalModelOperation, (model_id, body.request_id))
            if prior:
                if prior.fingerprint != fingerprint:
                    raise OperationError("request_id 已用于其他操作", "idempotency_conflict", 409)
                if "error" in prior.result:
                    failure = prior.result["error"]
                    raise OperationError(failure["message"], failure["code"], failure["status"])
                return LocalModelOut.model_validate(prior.result)
            state = await self._observation(session)
            if state is None:
                raise OperationError(
                    "Mac 原生模型工作进程未连接", "native_model_worker_unavailable", 503
                )
            if not state.compatible:
                raise OperationError("Mac 不支持本地模型", "unsupported_platform", 409)
            row = await session.get(LocalModelInstallation, model_id)
            current = row.revision if row else 0
            if current != body.expected_revision:
                raise RevisionConflictError(
                    body.expected_revision,
                    current,
                    self._output(model, row, state).model_dump(mode="json"),
                )
            observed = next((m for m in state.models if m.model_id == model_id), None)
            if body.action in {"repair", "stop", "uninstall"}:
                tasks = ModelInferenceTask.__table__.c
                unresolved = await session.scalar(
                    select(func.count())
                    .select_from(ModelInferenceTask.__table__)
                    .where(
                        tasks.provider_kind == "local_qwen_tts",
                        tasks.model_slug == model_id,
                        (
                            tasks.status.in_(
                                ("queued", "submitting", "pending", "processing", "running")
                            )
                        )
                        | (tasks.error_message == SUBMISSION_INTERRUPTED_MESSAGE),
                    )
                )
                if unresolved:
                    raise OperationError("模型仍有未结算的原生任务", "model_busy", 409)
            if observed and observed.busy and body.action in {"repair", "stop", "uninstall"}:
                raise OperationError("本地模型仍在执行任务", "model_busy", 409)
            if row is None:
                row = LocalModelInstallation(
                    id=model_id, status="not_installed", enabled=False, progress=0, revision=0
                )
                session.add(row)
            restore_enabled = row.enabled
            if body.action in {"install", "repair"}:
                if row.status == "installing" or (
                    body.action == "install" and row.status == "installed"
                ):
                    raise OperationError("模型正在安装或已安装", "model_busy", 409)
                if body.action == "repair" and (not observed or not observed.installed):
                    raise OperationError("模型权重未就绪", "local_model_unavailable", 409)
                row.status, row.enabled, row.progress = "installing", False, 0
            elif body.action == "cancel":
                if row.status != "installing":
                    raise OperationError("没有进行中的安装", "no_installation", 409)
                row.status, row.enabled = "cancelled", False
            else:
                if row.status != "installed" and not (
                    body.action == "uninstall" and row.status in {"failed", "cancelled"}
                ):
                    raise OperationError("模型尚未安装", "local_model_unavailable", 409)
                row.enabled = body.action == "enable"
                if body.action == "uninstall":
                    row.status, row.progress = "not_installed", 0
            row.revision = current + 1
            row.updated_at, row.error_message = utc_now(), None
            result = self._output(model, row, state)
            self._new_job(
                session,
                owner=authorization.owner_user_id,
                operation="models." + body.action,
                payload=ActionRequest(
                    model_id=model_id,
                    action=body.action,
                    target_revision=row.revision,
                    enable_on_completion=(
                        restore_enabled
                        if body.action == "repair"
                        else body.action in {"install", "enable"}
                    ),
                ).model_dump(),
                request_id="action:" + model_id + ":" + body.request_id,
                proof=proof,
            )
            session.add(
                LocalModelOperation(
                    model_id=model_id,
                    request_id=body.request_id,
                    fingerprint=fingerprint,
                    result=result.model_dump(mode="json"),
                )
            )
            await session.commit()
            return result

    async def report(self, worker, state):
        state = ModelsObservation.model_validate(state)
        async with self.database.sessions() as session:
            row = await session.get(NativeModelObservation, worker)
            if row is None:
                row = NativeModelObservation(id=worker, payload=state.model_dump(mode="json"))
                session.add(row)
            else:
                row.payload = state.model_dump(mode="json")
            row.observed_at = utc_now()
            # Observations do not enable models or rewrite command receipts.
            for item in state.models:
                installed = await session.get(LocalModelInstallation, item.model_id)
                if installed and installed.status == "installed" and not item.installed:
                    installed.status, installed.enabled = "failed", False
                    installed.error_message = "Mac 上的模型文件已不可用"
                    installed.revision += 1
            await session.commit()

    async def lease(self, worker, job_id, lease_id, *, finalizing=False):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            owner = await session.scalar(
                select(NativeModelJob.owner_user_id).where(NativeModelJob.id == job_id)
            )
        if not owner:
            raise OperationError("原生任务不存在", "native_job_not_found", 404)
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(NativeModelJob, job_id)
            proof = await session.get(NativeModelProof, job_id)
            if (
                row.worker_id != worker
                or row.lease_id != lease_id
                or proof is None
                or row.status
                not in ({"leased", "unknown", "completed"} if finalizing else {"leased"})
                or (not finalizing and row.lease_expires_at <= utc_now())
            ):
                raise OperationError("原生租约已结束", "native_lease_ended", 410)
            return row, proof

    async def authorize(self, worker, lease):
        row, proof = await self.lease(worker, str(lease.job_id), str(lease.lease_id))
        if (
            row.owner_user_id != lease.owner_user_id
            or row.payload != lease.payload
            or row.operation != lease.operation
        ):
            raise OperationError("原生任务内容不匹配", "native_lease_conflict", 409)
        if proof.accepted_at is not None:
            return True
        await self._active(proof, owner=row.owner_user_id, operation=row.operation)
        async with self.database.sessions(info={"owner_user_id": row.owner_user_id}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(NativeModelJob, row.id)
            if (
                current.status != "leased"
                or current.lease_id != str(lease.lease_id)
                or current.lease_expires_at <= utc_now()
            ):
                raise OperationError("原生租约已结束", "native_lease_ended", 410)
            if row.operation != "models.synthesize":
                installation = await session.get(LocalModelInstallation, row.payload["model_id"])
                if installation is None or installation.revision != row.payload["target_revision"]:
                    raise OperationError(
                        "原生模型操作已被较新操作替代", "native_action_superseded", 403
                    )
            if row.operation == "models.synthesize":
                task = await session.get(ModelInferenceTask, row.payload["task_id"])
                if (
                    task is None
                    or task_fingerprint("inference", task) != proof.source_fingerprint
                    or task.provider_kind != "local_qwen_tts"
                    or task.kind != "speech_synthesis"
                    or task.status != "submitting"
                ):
                    raise OperationError("原始模型任务已变化", "native_source_changed", 403)
            saved = await session.get(NativeModelProof, row.id)
            saved.accepted_at = utc_now()
            await session.commit()
        return True

    async def reference(self, worker, job_id, lease_id):
        row, proof = await self.lease(worker, job_id, lease_id)
        if proof.accepted_at is None or row.operation != "models.synthesize":
            raise OperationError("原生读取缺少执行意图", "native_not_started", 403)
        async with self.database.sessions(info={"owner_user_id": row.owner_user_id}) as session:
            asset = await session.get(ModelInferenceAsset, row.payload["reference_asset_id"])
            if asset is None or asset.task_id != row.payload["task_id"]:
                raise OperationError("原始参考音频不存在", "native_source_missing", 410)
            source = self.storage.root(row.owner_user_id) / "inputs" / asset.storage_key
            if source.is_symlink() or not source.is_file():
                raise OperationError("原始参考音频不存在", "native_source_missing", 410)
            return source, row.payload

    def artifact(self, job_id, content_sha256):
        from uuid import UUID

        from studio.runtime.files.signed_payloads import model_output_path

        job_id = str(UUID(job_id))
        model_output_path(job_id, content_sha256)
        root = self.settings.runtime_path / "native-model-outputs"
        target = root / job_id / content_sha256
        if root.is_symlink() or target.parent.is_symlink() or target.is_symlink():
            raise ValueError("原生模型输出目录不能是符号链接")
        return target

    async def synthesize(self, model_id, payload, validate):
        await validate()
        async with self.database.sessions() as session:
            task = await load_runner_task(
                session, ModelInferenceTask, payload["task_id"], subject="本地模型任务"
            )
            if task is None or task.model_slug != model_id or task.status != "submitting":
                raise ValueError("原始模型任务不可执行")
            owner, task_id = task.owner_user_id, task.id
            authorization = await session.get(TaskAuthorization, ("inference", task_id))
            if authorization is None or authorization.fingerprint != task_fingerprint(
                "inference", task
            ):
                raise ValueError("原始模型任务授权不匹配")
            asset = await session.get(
                ModelInferenceAsset, task.request_payload["reference_asset_id"]
            )
            if asset is None or asset.task_id != task_id:
                raise ValueError("原始参考音频不存在")
            source = self.storage.root(owner) / "inputs" / asset.storage_key
            output = Path(payload["output_path"])
            if (
                Path(payload["reference_path"]).resolve() != source.resolve()
                or output.parent.resolve() != (self.storage.root(owner) / "outputs").resolve()
            ):
                raise ValueError("本地模型文件不属于原任务")
            arguments = {
                key: task.request_payload[key] for key in ("text", "language", "reference_text")
            }
            expected_fingerprint = authorization.fingerprint
            from types import SimpleNamespace

            proof = SimpleNamespace(
                assertion=authorization.assertion,
                source_method=authorization.source_method,
                source_path=authorization.source_path,
                source_fingerprint=expected_fingerprint,
            )
            suffix = Path(asset.filename).suffix.lower()
        from studio.runtime.files.signed_payloads import ModelOutputDescription

        description = await asyncio.to_thread(
            ModelOutputDescription.from_file, source, "reference" + suffix, asset.mime_type
        )
        arguments = SpeechRequest(
            model_id=model_id,
            task_id=task_id,
            **arguments,
            reference_asset_id=asset.id,
            reference_filename=description.filename,
            reference_byte_size=description.byte_size,
            reference_sha256=description.content_sha256,
        ).model_dump()
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            existing = await session.scalar(
                select(NativeModelJob).where(NativeModelJob.request_id == "inference:" + task_id)
            )
            if existing:
                if existing.payload != arguments:
                    raise ValueError("本地模型任务输入发生变化")
                job_id = existing.id
            else:
                current = await session.get(ModelInferenceTask, task_id)
                if (
                    current is None
                    or task_fingerprint("inference", current) != expected_fingerprint
                    or current.status != "submitting"
                ):
                    raise ValueError("本地模型任务输入发生变化")
                job = self._new_job(
                    session,
                    owner=owner,
                    operation="models.synthesize",
                    payload=arguments,
                    request_id="inference:" + task_id,
                    proof=proof,
                )
                await session.commit()
                job_id = job.id
        try:
            result = await self.queue.wait(owner=owner, job_id=job_id, timeout=30)
            if result["status"] != "completed":
                raise NativeSubmissionUncertain()
            await self.copy_result(owner, job_id, output)
            return result["result"].get("metrics", {})
        except BaseException as exc:
            if isinstance(exc, NativeQueueError):
                raise NativeSubmissionUncertain() from None
            raise

    async def copy_result(self, owner, job_id, output):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            job = await session.get(NativeModelJob, job_id)
            if job is None or job.status != "completed" or not job.output_descriptor:
                raise NativeSubmissionUncertain()
            descriptor = dict(job.output_descriptor)
            source = self.artifact(job.id, descriptor["content_sha256"])
        from studio.runtime.files.signed_payloads import ModelOutputDescription

        observed = await asyncio.to_thread(
            ModelOutputDescription.from_file, source, "result.wav", "audio/wav"
        )
        if observed != ModelOutputDescription(**descriptor):
            raise NativeSubmissionUncertain()
        output.parent.mkdir(parents=True, exist_ok=True)
        copying = asyncio.create_task(asyncio.to_thread(shutil.copyfile, source, output))
        try:
            await asyncio.shield(copying)
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await copying
            raise

    async def recover(self):
        await self.retention.cleanup(startup=True)
        jobs = NativeModelJob.__table__.c
        submitted = (
            select(1)
            .where(
                jobs.operation.in_(("models.install", "models.repair")),
                jobs.payload["model_id"].as_string() == LocalModelInstallation.id,
                jobs.payload["target_revision"].as_integer() == LocalModelInstallation.revision,
                jobs.applied_at.is_(None),
            )
            .exists()
        )
        async with self.database.sessions() as session:
            await session.execute(
                update(LocalModelInstallation)
                .where(LocalModelInstallation.status == "installing", ~submitted)
                .values(
                    status="failed",
                    enabled=False,
                    error_message="安装已中断，请主动重试",
                    revision=LocalModelInstallation.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await session.commit()

    async def process_once(self):
        await self.retention.cleanup()
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(NativeModelJob.owner_user_id, NativeModelJob.id)
                    .where(NativeModelJob.applied_at.is_(None), NativeModelJob.status != "queued")
                    .limit(100)
                )
            )
        for owner, job_id in pending:
            result = await self.queue.get(owner=owner, job_id=job_id)
            if result["status"] in {"queued", "leased"}:
                continue
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                job = await session.get(NativeModelJob, job_id)
                if job.operation != "models.synthesize":
                    row = await session.get(LocalModelInstallation, job.payload["model_id"])
                    if row and job.status in {"completed", "failed", "unknown"}:
                        target_revision = job.payload["target_revision"]
                        unknown_message = "原生操作结果未确认，请核对原操作"
                        may_apply = row.revision == target_revision or (
                            row.revision == target_revision + 1
                            and row.status == "failed"
                            and row.error_message == unknown_message
                        )
                        if not may_apply:
                            if job.status != "unknown":
                                job.applied_at = utc_now()
                                await session.commit()
                            continue
                        if job.status == "unknown" and row.error_message == unknown_message:
                            continue
                        if job.status == "completed":
                            installed = bool((job.result or {}).get("installed"))
                            row.status = (
                                "installed"
                                if installed
                                else (
                                    "cancelled"
                                    if job.payload["action"] == "cancel"
                                    else "not_installed"
                                )
                            )
                            row.enabled = installed and job.payload["enable_on_completion"]
                            row.progress, row.error_message = (100 if installed else 0), None
                        else:
                            row.status, row.enabled = "failed", False
                            row.error_message = (
                                "原生操作结果未确认，请核对原操作"
                                if job.status == "unknown"
                                else "原生操作未执行"
                            )
                        row.revision += 1
                    if job.status != "unknown":
                        job.applied_at = utc_now()
                    await session.commit()
                    continue
                if self.inference is None:
                    continue
                task = await session.get(ModelInferenceTask, job.payload["task_id"])
                if task is not None and task.id in self.waiting:
                    continue
                if task is None or task.status == "completed":
                    job.applied_at = utc_now()
                    await session.commit()
                    continue
                if job.status == "completed" and job.output_descriptor:
                    if (
                        task.status == "failed"
                        and task.error_message != SUBMISSION_INTERRUPTED_MESSAGE
                    ):
                        continue
                    task.status, task.error_message = "processing", None
                    task.revision += 1
                    await session.commit()
                    task_id = task.id
                    key = "native-" + job.id
                    output = self.storage.root(owner) / "outputs" / key
                elif job.status == "failed":
                    task_id = task.id
                    await session.rollback()
                    await self.inference.store.fail(task_id, "本地模型操作在执行前被拒绝")
                    current = await session.get(NativeModelJob, job_id)
                    current.applied_at = utc_now()
                    await session.commit()
                    continue
                else:
                    continue
            await self.copy_result(owner, job_id, output)
            if await self.inference.finish(
                task_id,
                key,
                task_id + ".wav",
                "audio/wav",
                output.stat().st_size,
                (job.result or {}).get("metrics", {}),
            ):
                async with self.database.sessions(info={"owner_user_id": owner}) as session:
                    current = await session.get(NativeModelJob, job_id)
                    current.applied_at = utc_now()
                    await session.commit()

    async def close(self):
        await self.stop()


class DisconnectedNativeModels:
    """Compatibility default when no native lane has been configured."""

    async def list(self, can_manage=False):
        items = []
        for model in manifest()["models"]:
            size = sum(part["size"] for part in model["files"])
            items.append(
                LocalModelOut(
                    id=model["id"],
                    label=model["label"],
                    repository=model["repository"],
                    license=model["license"],
                    model_revision=model["revision"],
                    download_bytes=size,
                    required_disk_bytes=size * 2 + 2 * 1024**3,
                    compatible=False,
                    status="not_installed",
                    enabled=False,
                    loaded=False,
                    busy=False,
                    progress=0,
                    revision=0,
                    error_message="Mac 原生模型工作进程尚未连接",
                )
            )
        return LocalModelsOut(can_manage=can_manage, items=items)

    async def action(self, model_id, _body, *, authorization=None):
        definition(model_id)
        if authorization is None:
            raise OperationError("原生模型操作缺少授权", "native_authorization_required", 403)
        raise OperationError("Mac 原生模型工作进程尚未连接", "native_model_worker_unavailable", 503)

    async def close(self):
        pass
