"""Catalogue/task occupancy checks query only the Models-owned execution records."""

from sqlalchemy import select

from app.llm.models import ModelInferenceTask, ModelTestGenerationTask, ModelTestTranscriptionTask

from .visual_generation_records import VisualProviderTask

TASKS = (
    (VisualProviderTask, ("prepared", "queued", "submitting", "pending", "processing")),
    (ModelInferenceTask, ("queued", "submitting", "pending", "processing", "running")),
    (ModelTestGenerationTask, ("queued", "submitting", "pending", "processing")),
    (ModelTestTranscriptionTask, ("queued", "running")),
)


class OwnedCatalogTaskUsage:
    def __init__(self, session):
        self.session = session

    async def _active(self, owner_user_id, *, column=None, identity=None):
        if not owner_user_id or self.session.info.get("owner_user_id") != owner_user_id:
            raise ValueError("任务占用检查缺少匹配的账号上下文")
        for model, statuses in TASKS:
            statement = select(model.id).where(
                model.owner_user_id == owner_user_id, model.status.in_(statuses)
            )
            if column:
                statement = statement.where(getattr(model, column) == identity)
            if await self.session.scalar(statement.limit(1)):
                return True
        return False

    async def account_active(self, *, owner_user_id):
        return await self._active(owner_user_id)

    async def model_active(self, *, owner_user_id, model_id):
        return await self._active(owner_user_id, column="model_id", identity=model_id)

    async def provider_active(self, *, owner_user_id, provider_id):
        return await self._active(owner_user_id, column="provider_id", identity=provider_id)
