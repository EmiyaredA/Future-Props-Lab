"""Migration-period task occupancy for the existing single-database website only."""

from sqlalchemy import func, select

from app.llm.models import ModelInferenceTask, ModelTestGenerationTask
from studio.runtime.database.orm_base import Base

GENERATION_ACTIVE = ("queued", "submitting", "pending", "processing")


class LegacyCatalogTaskUsage:
    def __init__(self, session):
        self.session = session

    async def _active(self, *, owner_user_id, column, identity):
        if not owner_user_id:
            raise ValueError("模型任务占用检查缺少账号")
        sources = (
            (Base.metadata.tables["visual_generation_tasks"], GENERATION_ACTIVE),
            (ModelTestGenerationTask.__table__, GENERATION_ACTIVE),
            (Base.metadata.tables["galgame_asset_transcription_tasks"], ("queued", "running")),
            (ModelInferenceTask.__table__, (*GENERATION_ACTIVE, "running")),
        )
        for table, statuses in sources:
            count = await self.session.scalar(
                select(func.count(table.c.id)).where(
                    table.c.owner_user_id == owner_user_id,
                    table.c[column] == identity,
                    table.c.status.in_(statuses),
                )
            )
            if count:
                return True
        return False

    async def model_active(self, *, owner_user_id, model_id):
        return await self._active(owner_user_id=owner_user_id, column="model_id", identity=model_id)

    async def provider_active(self, *, owner_user_id, provider_id):
        return await self._active(
            owner_user_id=owner_user_id, column="provider_id", identity=provider_id
        )
