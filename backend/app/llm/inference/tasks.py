from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.assets import VisualAssets
from app.capabilities.transcription import max_transcription_input_bytes
from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.inference.assets import InferenceAssets, LocalInput, root
from app.llm.inference.catalog import get_model, normalize_parameters
from app.models.model_inference import ModelInferenceAsset, ModelInferenceTask
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError, fingerprint
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from app.schemas.model_inference import InferenceTaskOut, InferenceTasksOut

ACTIVE = ("queued", "submitting", "pending", "processing", "running")


def task_out(row):
    return InferenceTaskOut(
        **{
            name: getattr(row, name)
            for name in InferenceTaskOut.model_fields
            if name not in {"result_available", "can_retry_materialization"}
        },
        result_available=bool(row.result_storage_key),
        can_retry_materialization=row.status == "failed" and bool(row.result_url),
    )


class InferenceTasks:
    def __init__(self, session, workspace_id):
        self.session, self.workspace_id = session, workspace_id

    async def row(self, task_id):
        row = await self.session.scalar(
            select(ModelInferenceTask)
            .where(
                ModelInferenceTask.id == task_id,
                ModelInferenceTask.workspace_id == self.workspace_id,
            )
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise OperationError("调用任务不存在", "not_found", 404)
        return row

    async def get(self, task_id):
        return task_out(await self.row(task_id))

    async def list(self, offset=0, limit=30):
        condition = ModelInferenceTask.workspace_id == self.workspace_id
        rows = await self.session.scalars(
            select(ModelInferenceTask)
            .where(condition)
            .order_by(ModelInferenceTask.created_at.desc(), ModelInferenceTask.id)
            .offset(offset)
            .limit(limit)
        )
        total = await self.session.scalar(
            select(func.count()).select_from(ModelInferenceTask).where(condition)
        )
        return InferenceTasksOut(items=[task_out(row) for row in rows], total=total)

    async def replay(self, body):
        row = await self.session.scalar(
            select(ModelInferenceTask).where(
                ModelInferenceTask.workspace_id == self.workspace_id,
                ModelInferenceTask.request_id == body.request_id,
            )
        )
        if row and row.fingerprint != fingerprint(body):
            raise OperationError("request_id 已用于其他调用", "idempotency_conflict", 409)
        return task_out(row) if row else None

    async def create(self, body, admission=None, credential: CredentialSnapshot | None = None):
        prior = await self.replay(body)
        if prior:
            return prior
        model, provider = await get_model(self.session, self.workspace_id, body.model_id, body.kind)
        assets = [
            await InferenceAssets(self.session, self.workspace_id).get(identity)
            for identity in body.asset_ids
        ]
        if len(set(body.asset_ids)) != len(body.asset_ids) or any(
            asset.task_id for asset in assets
        ):
            raise OperationError("输入素材重复或已被认领", "asset_in_use", 409)
        if body.kind == "transcription":
            if len(assets) != 1 or assets[0].media_kind != "audio":
                raise OperationError("语音识别需要一份音频输入")
            if Path(assets[0].filename).suffix.lower() not in {".mp3", ".wav", ".m4a", ".ogg"}:
                raise OperationError("语音识别支持 MP3、WAV、M4A、OGG")
            if assets[0].byte_size > max_transcription_input_bytes(provider):
                raise OperationError("音频超过当前模型的上传上限", "file_too_large", 413)
        payload = normalize_parameters(body, model, provider, assets)
        payload["asset_ids"] = body.asset_ids
        snap = credential or CredentialSnapshot()
        row = ModelInferenceTask(
            workspace_id=self.workspace_id,
            request_id=body.request_id,
            fingerprint=fingerprint(body),
            provider_id=provider.id,
            model_id=model.id,
            provider_kind=provider.kind,
            provider_name=provider.name,
            model_slug=model.slug,
            kind=body.kind,
            request_payload=payload,
            **snap.as_kwargs(),
        )
        self.session.add(row)
        try:
            await self.session.flush()
            for asset in assets:
                result = await self.session.execute(
                    update(ModelInferenceAsset)
                    .where(
                        ModelInferenceAsset.id == asset.id,
                        ModelInferenceAsset.workspace_id == self.workspace_id,
                        ModelInferenceAsset.task_id.is_(None),
                    )
                    .values(task_id=row.id)
                )
                if result.rowcount != 1:
                    raise OperationError("输入素材已被其他任务认领", "asset_in_use", 409)
            if admission:
                await admission([row.id])
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            prior = await self.replay(body)
            if prior:
                return prior
            raise
        except Exception:
            await self.session.rollback()
            raise
        return task_out(row)

    async def content(self, task_id):
        row = await self.row(task_id)
        path = root(self.workspace_id) / "outputs" / row.result_storage_key
        if not row.result_storage_key or not path.is_file():
            raise OperationError("调用结果尚不可用", "result_unavailable", 409)
        return path, row.result_filename, row.result_mime_type

    async def retry_materialization(self, task_id, expected, admission=None):
        row = await self.row(task_id)
        if row.revision != expected:
            raise RevisionConflictError(
                expected, row.revision, task_out(row).model_dump(mode="json")
            )
        if row.status != "failed" or not row.result_url:
            raise OperationError("此任务不能重试结果落盘", "retry_unavailable", 409)
        result = await self.session.execute(
            update(ModelInferenceTask)
            .where(
                ModelInferenceTask.id == task_id,
                ModelInferenceTask.workspace_id == self.workspace_id,
                ModelInferenceTask.revision == expected,
            )
            .values(
                status="processing", revision=expected + 1, error_message=None, updated_at=utc_now()
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(task_id)
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))
        if admission:
            await admission([task_id])
        await self.session.commit()
        return await self.get(task_id)

    async def delete(self, task_id, expected):
        row = await self.row(task_id)
        if row.status in ACTIVE:
            raise OperationError("进行中的任务不能删除", "task_busy", 409)
        paths = (
            [root(self.workspace_id) / "outputs" / row.result_storage_key]
            if row.result_storage_key
            else []
        )
        assets = await self.session.scalars(
            select(ModelInferenceAsset).where(ModelInferenceAsset.task_id == task_id)
        )
        paths += [root(self.workspace_id) / "inputs" / asset.storage_key for asset in assets]
        result = await self.session.execute(
            delete(ModelInferenceTask).where(
                ModelInferenceTask.id == task_id,
                ModelInferenceTask.workspace_id == self.workspace_id,
                ModelInferenceTask.revision == expected,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(task_id)
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))
        await self.session.commit()
        for path in paths:
            path.unlink(missing_ok=True)

    async def save_to_library(self, task_id):
        path, filename, mime_type = await self.content(task_id)
        source = LocalInput(path, filename, mime_type)
        await self.session.rollback()
        try:
            return await VisualAssets(
                self.session, get_settings(), workspace_id=self.workspace_id
            ).upload(source, project_id=None, folder_id=None)
        finally:
            await source.close()
