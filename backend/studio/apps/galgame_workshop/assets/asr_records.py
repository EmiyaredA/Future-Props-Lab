"""Galgame-owned ASR settings and transcripts with injected model readiness."""

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.errors import AssetError
from studio.apps.galgame_workshop.schemas import (
    GalgameAsrSettingsOut,
    GalgameAsrSettingsPatchIn,
    GalgameTranscriptionTaskListOut,
    GalgameTranscriptionTaskOut,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    GalgameWorkshopProject,
)
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


def transcription_task_out(row: GalgameAssetTranscriptionTask) -> GalgameTranscriptionTaskOut:
    return GalgameTranscriptionTaskOut(
        id=row.id,
        assetId=row.asset_id,
        providerName=row.provider_name,
        modelSlug=row.model_slug,
        language=row.language,
        force=row.force,
        status=row.status,
        resultText=row.result_text,
        resultSegments=list(row.result_segments or []),
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


def settings_out(row, model_ready):
    return GalgameAsrSettingsOut(
        modelId=row.asr_model_id,
        modelReady=model_ready,
        defaultLanguage=row.default_language,
        concurrency=row.concurrency,
        revision=row.revision,
    )


class AsrRecords:
    def __init__(self, session: AsyncSession, model_ready) -> None:
        self.session = session
        self.model_ready = model_ready

    async def _project(self, project_id: str) -> None:
        if await self.session.get(GalgameWorkshopProject, project_id) is None:
            raise AssetError("项目不存在", code="not_found", status=404)

    async def _settings(self, project_id: str) -> GalgameAssetSettings:
        await self._project(project_id)
        row = await self.session.get(GalgameAssetSettings, project_id)
        if row is None:
            await self.session.rollback()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self._project(project_id)
            row = await self.session.get(GalgameAssetSettings, project_id)
            if row is None:
                row = GalgameAssetSettings(project_id=project_id)
                self.session.add(row)
                await self.session.flush()
            await self.session.commit()
        return row

    async def _settings_out(self, row: GalgameAssetSettings) -> GalgameAsrSettingsOut:
        ready = bool(row.asr_model_id and await self.model_ready(row.asr_model_id))
        return settings_out(row, ready)

    async def get_settings(self, project_id: str) -> GalgameAsrSettingsOut:
        return await self._settings_out(await self._settings(project_id))

    async def patch_settings(
        self, project_id: str, body: GalgameAsrSettingsPatchIn
    ) -> GalgameAsrSettingsOut:
        row = await self._settings(project_id)
        model_id = body.model_id if "model_id" in body.model_fields_set else row.asr_model_id
        ready = bool(model_id and await self.model_ready(model_id))
        if body.model_id is not None and not ready:
            raise AssetError(
                "只能选择已启用的 OpenAI 兼容或 SenseAudio 语音识别模型",
                code="asr_model_unavailable",
            )
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if "model_id" in body.model_fields_set:
            values["asr_model_id"] = body.model_id
        if body.default_language is not None:
            values["default_language"] = body.default_language
        if body.concurrency is not None:
            values["concurrency"] = body.concurrency
        result = await self.session.execute(
            update(GalgameAssetSettings)
            .where(
                GalgameAssetSettings.project_id == project_id,
                GalgameAssetSettings.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self._settings(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                (await self._settings_out(current)).model_dump(mode="json", by_alias=True),
            )
        await self.session.refresh(row)
        result = settings_out(row, ready)
        await self.session.commit()
        return result

    async def list_tasks(self, project_id: str) -> GalgameTranscriptionTaskListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameAssetTranscriptionTask)
                    .where(GalgameAssetTranscriptionTask.project_id == project_id)
                    .order_by(GalgameAssetTranscriptionTask.created_at.desc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        return GalgameTranscriptionTaskListOut(items=[transcription_task_out(row) for row in rows])
