"""Installation state transitions use short transactions; downloads never hold a transaction."""

import asyncio
import hashlib
import json
import shutil

from sqlalchemy import select, update

from studio.apps.model_service.local_models.catalog import compatible, definition, manifest
from studio.apps.model_service.storage.models.local_models import (
    LocalModelInstallation,
    LocalModelOperation,
)
from studio.config.local_models import FFMPEG_MODEL_ID, LOCAL_VIDEO_MODEL_IDS, RELAY_MODEL_ID
from studio.contracts.model_service.schemas.local_models import LocalModelOut, LocalModelsOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class LocalModels:
    def __init__(self, session_factory, installer, runtime):
        self.sessions, self.installer, self.runtime = session_factory, installer, runtime
        self.jobs = {}
        self.relay_busy = lambda: False

    def output(self, model, row):
        size = sum(item["size"] for item in model["files"])
        relay = model["id"] == RELAY_MODEL_ID
        builtin = model["id"] == FFMPEG_MODEL_ID
        platform_ready = compatible() and (
            self.installer.fast_video_available()
            if builtin
            else not relay or self.installer.relay_available()
        )
        return LocalModelOut(
            id=model["id"],
            label=model["label"],
            capability=model.get("capability", "speech_synthesis"),
            repository=model["repository"],
            license=model["license"],
            model_revision=model["revision"],
            download_bytes=size,
            required_disk_bytes=0 if builtin else size * 2 + 2 * 1024**3,
            compatible=platform_ready,
            status=("installed" if platform_ready else "not_installed")
            if builtin
            else row.status
            if row
            else "not_installed",
            enabled=bool(row and row.enabled and (not builtin or platform_ready)),
            loaded=self.runtime.model_id == model["id"]
            and self.runtime.process is not None
            and self.runtime.process.returncode is None,
            busy=self.relay_busy() if model["id"] in LOCAL_VIDEO_MODEL_IDS else self.runtime.busy,
            progress=row.progress if row else 0,
            revision=row.revision if row else 0,
            error_message=(
                "需要完成本机 Metal 验收后才可安装"
                if relay and not platform_ready
                else "需要本机 FFmpeg、FFprobe 和 VideoToolbox 编码支持"
                if builtin and not platform_ready
                else row.error_message
                if row
                else None
            ),
        )

    async def list(self, can_manage=False):
        async with self.sessions() as session:
            rows = {r.id: r for r in await session.scalars(select(LocalModelInstallation))}
            return LocalModelsOut(
                can_manage=can_manage,
                items=[self.output(model, rows.get(model["id"])) for model in manifest()["models"]],
            )

    async def recover(self):
        async with self.sessions() as session:
            await session.execute(
                update(LocalModelInstallation)
                .where(LocalModelInstallation.status == "installing")
                .values(
                    status="failed",
                    enabled=False,
                    error_message="安装已中断，请主动重试",
                    revision=LocalModelInstallation.revision + 1,
                    updated_at=utc_now(),
                )
            )
            for row in await session.scalars(
                select(LocalModelInstallation).where(LocalModelInstallation.status == "installed")
            ):
                if row.id != FFMPEG_MODEL_ID and not self.files_present(row.id):
                    row.status, row.enabled = "failed", False
                    row.error_message = "本地模型文件缺失，请主动重新安装"
                    row.revision += 1
            await session.commit()

    def files_present(self, model_id):
        if model_id == RELAY_MODEL_ID:
            return self.installer.model_files_present(model_id)
        return (
            self.installer.python.is_file()
            and (self.installer.model_path(model_id) / "config.json").is_file()
        )

    async def action(self, model_id, body, *, authorization=None):
        if authorization is not None and (
            authorization.method != "POST"
            or authorization.path != "/v1/platform/local-models/" + model_id + "/actions"
        ):
            raise OperationError("本地模型操作来源不匹配", "invalid_native_action", 403)
        model = definition(model_id)
        fingerprint = hashlib.sha256(
            json.dumps(body.model_dump(), sort_keys=True).encode()
        ).hexdigest()
        async with self.runtime.control:
            async with self.sessions() as session:
                prior = await session.get(LocalModelOperation, (model_id, body.request_id))
                if prior:
                    if prior.fingerprint != fingerprint:
                        raise OperationError(
                            "request_id 已用于其他操作", "idempotency_conflict", 409
                        )
                    if "error" in prior.result:
                        failure = prior.result["error"]
                        raise OperationError(failure["message"], failure["code"], failure["status"])
                    return LocalModelOut.model_validate(prior.result)
                row = await session.get(LocalModelInstallation, model_id)
                if (row.revision if row else 0) != body.expected_revision:
                    raise RevisionConflictError(
                        body.expected_revision,
                        row.revision if row else 0,
                        self.output(model, row).model_dump(),
                    )
                builtin = model_id == FFMPEG_MODEL_ID
                if builtin and body.action not in {"enable", "stop"}:
                    raise OperationError("本机 FFmpeg 支持启用和停止", "invalid_local_action", 409)
                if (
                    builtin
                    and body.action == "enable"
                    and (not compatible() or not self.installer.fast_video_available())
                ):
                    raise OperationError("本机 FFmpeg 编码环境不可用", "ffmpeg_unavailable", 409)
                if not row:
                    row = LocalModelInstallation(
                        id=model_id,
                        status="installed" if builtin else "not_installed",
                        enabled=False,
                        progress=0,
                        revision=0,
                    )
                    session.add(row)
                    await session.flush()
                previous_enabled = row.enabled
                relay = model_id == RELAY_MODEL_ID
                busy = self.relay_busy() if model_id in LOCAL_VIDEO_MODEL_IDS else self.runtime.busy
                if (
                    relay
                    and body.action in {"install", "repair", "enable"}
                    and (not compatible() or not self.installer.relay_available())
                ):
                    raise OperationError("需要完成本机 Metal 验收", "metal_unverified", 409)
                if body.action in {"install", "repair"}:
                    if not compatible():
                        raise OperationError(
                            "本地语音需要 macOS 15 或更新版本的 Apple Silicon Mac",
                            "unsupported_platform",
                            409,
                        )
                    if body.action == "repair" and (
                        busy
                        or getattr(self.runtime, "maintenance", False)
                        or any(not job.done() for job in self.jobs.values())
                        or not (
                            self.files_present(model_id)
                            if relay
                            else (self.installer.model_path(model_id) / "config.json").is_file()
                        )
                    ):
                        raise OperationError("请等待任务结束并确认模型权重完整", "model_busy", 409)
                    if row.status == "installing" or (
                        body.action == "install" and row.status == "installed"
                    ):
                        raise OperationError("模型正在安装或已安装", "model_busy", 409)
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
                    if busy and body.action in {"stop", "uninstall"}:
                        raise OperationError(
                            "本地视频正在增强，请先暂停任务"
                            if model_id in LOCAL_VIDEO_MODEL_IDS
                            else "本地语音正在生成，请完成后重试",
                            "model_busy",
                            409,
                        )
                    row.enabled = body.action == "enable"
                    if body.action == "uninstall":
                        row.status, row.progress = "not_installed", 0
                row.revision += 1
                row.error_message = None
                row.updated_at = utc_now()
                result = self.output(model, row)
                values = {
                    name: getattr(row, name)
                    for name in (
                        "status",
                        "enabled",
                        "progress",
                        "revision",
                        "error_message",
                        "updated_at",
                    )
                }
                session.expunge(row)
                changed = await session.execute(
                    update(LocalModelInstallation)
                    .where(
                        LocalModelInstallation.id == model_id,
                        LocalModelInstallation.revision == body.expected_revision,
                    )
                    .values(**values)
                )
                if changed.rowcount != 1:
                    await session.rollback()
                    current = await session.get(LocalModelInstallation, model_id)
                    raise RevisionConflictError(
                        body.expected_revision,
                        current.revision,
                        self.output(model, current).model_dump(),
                    )
                session.add(
                    LocalModelOperation(
                        model_id=model_id,
                        request_id=body.request_id,
                        fingerprint=fingerprint,
                        result=result.model_dump(),
                    )
                )
                await session.commit()
            if body.action in {"install", "repair"}:
                if body.action == "repair" and not relay:
                    await self.runtime.close()
                    self.runtime.maintenance = True
                job = asyncio.create_task(
                    self.install(
                        model, repair=body.action == "repair", restore_enabled=previous_enabled
                    )
                )
                self.jobs[model_id] = job
            elif body.action == "cancel":
                job = self.jobs.get(model_id)
                if job:
                    job.cancel()
                    await asyncio.gather(job, return_exceptions=True)
            elif body.action in {"stop", "uninstall"}:
                if self.runtime.model_id == model_id:
                    await self.runtime.close()
                if body.action == "uninstall":
                    try:
                        for target in (
                            self.installer.model_path(model_id),
                            self.installer.root / "staging" / model_id,
                        ):
                            if target.exists():
                                await asyncio.to_thread(shutil.rmtree, target)
                    except OSError:
                        message = "清理模型文件失败，请检查磁盘权限后重试"
                        async with self.sessions() as session:
                            await session.execute(
                                update(LocalModelInstallation)
                                .where(LocalModelInstallation.id == model_id)
                                .values(
                                    status="failed",
                                    enabled=False,
                                    error_message=message,
                                    revision=LocalModelInstallation.revision + 1,
                                )
                            )
                            receipt = await session.get(
                                LocalModelOperation, (model_id, body.request_id)
                            )
                            receipt.result = {
                                "error": {
                                    "message": message,
                                    "code": "cleanup_failed",
                                    "status": 409,
                                }
                            }
                            await session.commit()
                        raise OperationError(message, "cleanup_failed", 409) from None
            return result

    async def install(self, model, *, repair=False, restore_enabled=True):
        try:

            async def report(progress):
                async with self.sessions() as session:
                    await session.execute(
                        update(LocalModelInstallation)
                        .where(
                            LocalModelInstallation.id == model["id"],
                            LocalModelInstallation.status == "installing",
                            LocalModelInstallation.progress < progress,
                        )
                        .values(progress=progress)
                    )
                    await session.commit()

            try:
                if repair:
                    await self.installer.install(model, report, repair=True)
                else:
                    await self.installer.install(model, report)
                status, message = "installed", None
            except asyncio.CancelledError:
                return
            except Exception as exc:
                status, message = (
                    "failed",
                    (
                        str(exc)
                        if isinstance(exc, ValueError)
                        else "下载或安装失败，请检查网络后重试"
                    ),
                )
            async with self.sessions() as session:
                await session.execute(
                    update(LocalModelInstallation)
                    .where(
                        LocalModelInstallation.id == model["id"],
                        LocalModelInstallation.status == "installing",
                    )
                    .values(
                        status=status,
                        error_message=message,
                        enabled=status == "installed" and (restore_enabled if repair else True),
                        progress=100 if status == "installed" else 0,
                        revision=LocalModelInstallation.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                await session.commit()
        finally:
            if repair and model["id"] != RELAY_MODEL_ID:
                self.runtime.maintenance = False

    async def close(self):
        for job in self.jobs.values():
            job.cancel()
        await asyncio.gather(*self.jobs.values(), return_exceptions=True)
        await self.runtime.close()
