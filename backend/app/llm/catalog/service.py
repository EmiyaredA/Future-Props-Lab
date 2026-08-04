from __future__ import annotations

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.credentials import decrypt_secret, encrypt_secret
from app.models import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
    ModelTestGenerationTask,
    VisualGenerationTask,
)
from app.schemas.model_service import (
    ModelCatalogOut,
    ModelCategoryListOut,
    ModelCategoryOut,
    ModelEntryIn,
    ModelEntryOut,
    ProviderIn,
    ProviderOut,
)


class ResourceNotFoundError(Exception):
    pass


class DuplicateModelError(Exception):
    pass


class CatalogResourceBusyError(Exception):
    pass


ACTIVE_GENERATION_STATUSES = ("queued", "submitting", "pending", "processing")


def _key_hint(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        value = decrypt_secret(ciphertext)
    except Exception:
        return ""
    return value[-4:] if len(value) >= 4 else "••••"


MODEL_CATEGORIES = (
    ModelCategoryOut(id="text_generation", label="文本生成", type="text", sub_type="chat"),
    ModelCategoryOut(id="other_general", label="其他通用模型", type="text"),
    ModelCategoryOut(
        id="speech_synthesis", label="语音合成", type="audio", sub_type="text-to-speech"
    ),
    ModelCategoryOut(
        id="speech_recognition", label="语音识别", type="audio", sub_type="speech-to-text"
    ),
    ModelCategoryOut(
        id="music_generation", label="音乐生成", type="audio", sub_type="text-to-music"
    ),
    ModelCategoryOut(
        id="video_generation", label="视频生成", type="video", sub_type="text-to-video"
    ),
    ModelCategoryOut(
        id="image_generation", label="图片生成", type="image", sub_type="text-to-image"
    ),
    ModelCategoryOut(
        id="end_to_end_speech", label="端到端语音模型", type="audio", sub_type="speech-to-speech"
    ),
)


def _default_categories(row: ModelEntry) -> list[str]:
    capabilities = list(row.capabilities or [])
    if "image_generation" in capabilities:
        return ["image_generation"]
    if "video_generation" in capabilities:
        return ["video_generation"]
    return ["text_generation"]


def _model_out(row: ModelEntry) -> ModelEntryOut:
    return ModelEntryOut(
        id=row.id,
        provider_id=row.provider_id,
        slug=row.slug,
        label=row.label,
        description=row.description,
        capabilities=list(row.capabilities or []),
        categories=list(row.categories or []) or _default_categories(row),
        enabled=row.enabled,
    )


class ModelCatalogService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def categories(self) -> ModelCategoryListOut:
        return ModelCategoryListOut(items=list(MODEL_CATEGORIES))

    async def catalog(self) -> ModelCatalogOut:
        state = await self.session.get(ModelCatalogState, "default")
        revision = int(state.revision if state else 0)
        providers = (
            (
                await self.session.execute(
                    select(ModelProvider).order_by(ModelProvider.sort_order, ModelProvider.name)
                )
            )
            .scalars()
            .all()
        )
        entries = (
            (
                await self.session.execute(
                    select(ModelEntry).order_by(ModelEntry.sort_order, ModelEntry.slug)
                )
            )
            .scalars()
            .all()
        )
        grouped: dict[str, list[ModelEntry]] = {}
        for entry in entries:
            grouped.setdefault(entry.provider_id, []).append(entry)
        return ModelCatalogOut(
            revision=revision,
            providers=[self._provider_out(row, grouped.get(row.id, [])) for row in providers],
        )

    def _provider_out(self, row: ModelProvider, models: list[ModelEntry]) -> ProviderOut:
        return ProviderOut(
            id=row.id,
            name=row.name,
            kind=row.kind,
            base_url=row.base_url,
            enabled=row.enabled,
            has_api_key=bool(row.api_key_ciphertext),
            api_key_hint=_key_hint(row.api_key_ciphertext),
            models=[_model_out(item) for item in models],
        )

    async def _conflict(self, expected: int) -> RevisionConflictError:
        await self.session.rollback()
        current = await self.catalog()
        return RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def _bump(self, expected: int) -> int:
        result = await self.session.execute(
            update(ModelCatalogState)
            .where(
                ModelCatalogState.id == "default",
                ModelCatalogState.revision == expected,
            )
            .values(revision=ModelCatalogState.revision + 1)
        )
        if result.rowcount != 1:
            raise await self._conflict(expected)
        return expected + 1

    async def get_provider(self, provider_id: str) -> ModelProvider:
        row = await self.session.get(ModelProvider, provider_id)
        if row is None:
            raise ResourceNotFoundError("供应商不存在")
        return row

    async def get_model(self, model_id: str) -> ModelEntry:
        row = await self.session.get(ModelEntry, model_id)
        if row is None:
            raise ResourceNotFoundError("模型不存在")
        return row

    async def create_provider(self, body: ProviderIn) -> tuple[int, ProviderOut]:
        revision = await self._bump(body.expected_catalog_revision)
        count = int((await self.session.execute(select(func.count(ModelProvider.id)))).scalar_one())
        row = ModelProvider(
            name=body.name.strip(),
            kind=body.kind,
            base_url=body.base_url,
            api_key_ciphertext=encrypt_secret(body.api_key) if body.api_key.strip() else "",
            enabled=body.enabled,
            sort_order=count,
        )
        self.session.add(row)
        await self.session.flush()
        result = self._provider_out(row, [])
        await self.session.commit()
        return revision, result

    async def update_provider(self, provider_id: str, body: ProviderIn) -> tuple[int, ProviderOut]:
        revision = await self._bump(body.expected_catalog_revision)
        row = await self.get_provider(provider_id)
        if (not body.enabled or body.kind != row.kind) and await self._provider_has_active_tasks(
            provider_id
        ):
            raise CatalogResourceBusyError("供应商仍有进行中的生成任务")
        row.name = body.name.strip()
        row.kind = body.kind
        row.base_url = body.base_url
        row.enabled = body.enabled
        if body.api_key.strip():
            row.api_key_ciphertext = encrypt_secret(body.api_key)
        entries = (
            (
                await self.session.execute(
                    select(ModelEntry)
                    .where(ModelEntry.provider_id == provider_id)
                    .order_by(ModelEntry.sort_order)
                )
            )
            .scalars()
            .all()
        )
        result = self._provider_out(row, entries)
        await self.session.commit()
        return revision, result

    async def set_provider_enabled(
        self, provider_id: str, enabled: bool, expected: int
    ) -> tuple[int, ProviderOut]:
        row = await self.get_provider(provider_id)
        if not enabled and await self._provider_has_active_tasks(provider_id):
            raise CatalogResourceBusyError("供应商仍有进行中的生成任务")
        body = ProviderIn(
            expected_catalog_revision=expected,
            name=row.name,
            kind=row.kind,
            base_url=row.base_url,
            enabled=enabled,
        )
        return await self.update_provider(provider_id, body)

    async def delete_provider(self, provider_id: str, expected: int) -> int:
        if await self._provider_has_active_tasks(provider_id):
            raise CatalogResourceBusyError("供应商仍有进行中的生成任务")
        revision = await self._bump(expected)
        row = await self.get_provider(provider_id)
        await self.session.delete(row)
        await self.session.commit()
        return revision

    async def add_model(self, provider_id: str, body: ModelEntryIn) -> tuple[int, ModelEntryOut]:
        provider = await self.get_provider(provider_id)
        revision = await self._bump(body.expected_catalog_revision)
        count = int(
            (
                await self.session.execute(
                    select(func.count(ModelEntry.id)).where(ModelEntry.provider_id == provider_id)
                )
            ).scalar_one()
        )
        row = ModelEntry(
            provider_id=provider_id,
            slug=body.slug.strip(),
            label=body.label.strip(),
            description=body.description.strip(),
            capabilities=list(dict.fromkeys(body.capabilities)),
            categories=list(dict.fromkeys(body.categories))
            or _categories_for_provider_kind(provider.kind),
            enabled=body.enabled,
            sort_order=count,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateModelError("同一供应商下模型标识不能重复") from exc
        result = _model_out(row)
        await self.session.commit()
        return revision, result

    async def update_model(self, model_id: str, body: ModelEntryIn) -> tuple[int, ModelEntryOut]:
        row = await self.get_model(model_id)
        provider = await self.get_provider(row.provider_id)
        revision = await self._bump(body.expected_catalog_revision)
        row.slug = body.slug.strip()
        row.label = body.label.strip()
        row.description = body.description.strip()
        row.capabilities = list(dict.fromkeys(body.capabilities))
        row.categories = list(dict.fromkeys(body.categories)) or _categories_for_provider_kind(
            provider.kind
        )
        row.enabled = body.enabled
        try:
            await self.session.flush()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateModelError("同一供应商下模型标识不能重复") from exc
        result = _model_out(row)
        await self.session.commit()
        return revision, result

    async def delete_model(self, model_id: str, expected: int) -> int:
        await self.get_model(model_id)
        active = await self.session.scalar(
            select(func.count(VisualGenerationTask.id)).where(
                VisualGenerationTask.model_id == model_id,
                VisualGenerationTask.status.in_(ACTIVE_GENERATION_STATUSES),
            )
        )
        test_active = await self.session.scalar(
            select(func.count(ModelTestGenerationTask.id)).where(
                ModelTestGenerationTask.model_id == model_id,
                ModelTestGenerationTask.status.in_(ACTIVE_GENERATION_STATUSES),
            )
        )
        if active or test_active:
            raise CatalogResourceBusyError("模型仍有进行中的生成任务")
        revision = await self._bump(expected)
        await self.session.execute(delete(ModelEntry).where(ModelEntry.id == model_id))
        await self.session.commit()
        return revision

    async def _provider_has_active_tasks(self, provider_id: str) -> bool:
        count = await self.session.scalar(
            select(func.count(VisualGenerationTask.id)).where(
                VisualGenerationTask.provider_id == provider_id,
                VisualGenerationTask.status.in_(ACTIVE_GENERATION_STATUSES),
            )
        )
        test_count = await self.session.scalar(
            select(func.count(ModelTestGenerationTask.id)).where(
                ModelTestGenerationTask.provider_id == provider_id,
                ModelTestGenerationTask.status.in_(ACTIVE_GENERATION_STATUSES),
            )
        )
        return bool(count or test_count)


def _categories_for_provider_kind(kind: str) -> list[str]:
    if kind == "senseaudio_image":
        return ["image_generation"]
    if kind == "senseaudio_video":
        return ["video_generation"]
    return ["text_generation"]
