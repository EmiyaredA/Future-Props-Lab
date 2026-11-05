from __future__ import annotations

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.credentials import encrypt_secret
from app.runtime.secret_hints import encrypted_secret_hint
from studio.apps.model_service.catalog.default_storage import CatalogDefaults
from studio.apps.model_service.catalog.metadata import categories_for_provider
from studio.apps.model_service.catalog.supplier_records import get_supplier, list_suppliers
from studio.apps.model_service.catalog.task_usage import CatalogTaskUsage
from studio.apps.model_service.local_models.catalog import (
    definition,
    host_compatible,
    require_ready,
)
from studio.apps.model_service.storage.models.local_models import LocalModelInstallation
from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)
from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
from studio.contracts.model_service.schemas.model_service import (
    ModelCatalogOut,
    ModelCategoryListOut,
    ModelCategoryOut,
    ModelEntryIn,
    ModelEntryOut,
    ProviderIn,
    ProviderOut,
)
from studio.runtime.revisions import RevisionConflictError


class ResourceNotFoundError(Exception):
    pass


class DuplicateModelError(Exception):
    pass


class CatalogResourceBusyError(Exception):
    pass


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
        id="image_generation", label="图像生成", type="image", sub_type="text-to-image"
    ),
    ModelCategoryOut(
        id="end_to_end_speech", label="端到端语音模型", type="audio", sub_type="speech-to-speech"
    ),
)


def _default_categories(row: ModelEntry) -> list[str]:
    capabilities = list(row.capabilities or [])
    if "speech_synthesis" in capabilities:
        return ["speech_synthesis"]
    if "image_generation" in capabilities:
        return ["image_generation"]
    if "video_generation" in capabilities:
        return ["video_generation"]
    if "speech_recognition" in capabilities:
        return ["speech_recognition"]
    if "voice" in capabilities:
        return ["end_to_end_speech"]
    return ["text_generation"]


def _model_out(row: ModelEntry) -> ModelEntryOut:
    return ModelEntryOut(
        id=row.id,
        provider_id=row.provider_id,
        origin=row.origin,
        template_key=row.template_key,
        managed_fields=["slug", "label", "description", "capabilities", "categories"]
        if row.origin == "role_template"
        else [],
        slug=row.slug,
        label=row.label,
        description=row.description,
        capabilities=list(row.capabilities or []),
        categories=list(row.categories or []) or _default_categories(row),
        enabled=row.enabled,
    )


class ModelCatalogService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        task_usage: CatalogTaskUsage | None = None,
        defaults_store: CatalogDefaults | None = None,
    ) -> None:
        self.session = session
        self.task_usage = task_usage
        self.defaults_store = defaults_store

    def _task_usage(self) -> CatalogTaskUsage:
        if self.task_usage is None:
            raise RuntimeError("模型目录修改缺少明确的任务占用检查")
        return self.task_usage

    def categories(self) -> ModelCategoryListOut:
        return ModelCategoryListOut(items=list(MODEL_CATEGORIES))

    def _owner_user_id(self) -> str:
        owner_user_id = str(self.session.info.get("owner_user_id") or "").strip()
        if not owner_user_id:
            raise RuntimeError("model catalog session is not bound to an account")
        return owner_user_id

    async def catalog(self) -> ModelCatalogOut:
        owner_user_id = self._owner_user_id()
        if self.defaults_store is None:
            raise RuntimeError("模型目录缺少明确的账号默认模型存储")
        defaults = await self.defaults_store.read(owner_user_id=owner_user_id)
        state = await self.session.get(ModelCatalogState, owner_user_id)
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
        installations = {
            item.id: item for item in await self.session.scalars(select(LocalModelInstallation))
        }
        platform_compatible = await host_compatible(self.session)
        grouped: dict[str, list[ModelEntry]] = {}
        for entry in entries:
            grouped.setdefault(entry.provider_id, []).append(entry)

        def provider_out(provider):
            result = self._provider_out(provider, grouped.get(provider.id, []))
            if provider.kind == "local_qwen_tts":
                for model in result.models:
                    installation = installations.get(model.slug)
                    model.availability = (
                        "unsupported_platform"
                        if not platform_compatible
                        else "not_installed"
                        if not installation or installation.status != "installed"
                        else "stopped"
                        if not installation.enabled
                        else "ready"
                    )
            return result

        return ModelCatalogOut(
            revision=revision,
            default_model_ids=defaults,
            suppliers=await list_suppliers(self.session, owner_user_id),
            providers=[provider_out(row) for row in providers],
        )

    def _provider_out(self, row: ModelProvider, models: list[ModelEntry]) -> ProviderOut:
        return ProviderOut(
            id=row.id,
            supplier_id=row.supplier_id,
            name=row.name,
            origin=row.origin,
            template_key=row.template_key,
            managed_fields=["name", "kind", "base_url", "api_key", "supplier_id"]
            if row.origin == "role_template"
            else [],
            kind=row.kind,
            base_url=row.base_url,
            enabled=row.enabled,
            has_api_key=bool(row.api_key_ciphertext),
            api_key_hint=encrypted_secret_hint(row.api_key_ciphertext),
            models=[_model_out(item) for item in models],
        )

    async def _conflict(self, expected: int) -> RevisionConflictError:
        await self.session.rollback()
        current = await self.catalog()
        return RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def advance_revision(self, expected: int) -> int:
        result = await self.session.execute(
            update(ModelCatalogState)
            .where(
                ModelCatalogState.owner_user_id == self._owner_user_id(),
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
        revision = await self.advance_revision(body.expected_catalog_revision)
        await self._validate_supplier(body.supplier_id)
        count = int((await self.session.execute(select(func.count(ModelProvider.id)))).scalar_one())
        row = ModelProvider(
            owner_user_id=self._owner_user_id(),
            name=body.name.strip(),
            supplier_id=body.supplier_id,
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
        revision = await self.advance_revision(body.expected_catalog_revision)
        row = await self.get_provider(provider_id)
        if "supplier_id" in body.model_fields_set:
            if row.origin == "role_template" and body.supplier_id != row.supplier_id:
                raise CatalogResourceBusyError("模板管理的连接归属只能在全局设置中修改")
            await self._validate_supplier(body.supplier_id)
            row.supplier_id = body.supplier_id
        if (not body.enabled or body.kind != row.kind) and await self._provider_has_active_tasks(
            provider_id
        ):
            raise CatalogResourceBusyError("供应商仍有进行中的生成任务")
        if row.origin == "role_template" and (
            body.name.strip() != row.name
            or body.kind != row.kind
            or body.base_url != row.base_url
            or body.api_key.strip()
        ):
            raise CatalogResourceBusyError("模板管理的连接定义只能在全局设置中修改")
        row.name = body.name.strip()
        row.kind = body.kind
        row.base_url = body.base_url
        row.enabled = body.enabled
        if body.kind == "local_qwen_tts":
            row.api_key_ciphertext = ""
        elif body.api_key.strip():
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

    async def _validate_supplier(self, supplier_id: str | None) -> None:
        if (
            supplier_id is not None
            and await get_supplier(self.session, self._owner_user_id(), supplier_id) is None
        ):
            raise ResourceNotFoundError("供应商分组不存在")

    async def set_provider_enabled(
        self, provider_id: str, enabled: bool, expected: int
    ) -> tuple[int, ProviderOut]:
        row = await self.get_provider(provider_id)
        if not enabled and await self._provider_has_active_tasks(provider_id):
            raise CatalogResourceBusyError("供应商仍有进行中的任务")
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
            raise CatalogResourceBusyError("供应商仍有进行中的任务")
        revision = await self.advance_revision(expected)
        row = await self.get_provider(provider_id)
        if row.origin == "role_template":
            raise CatalogResourceBusyError("模板管理项不能在账号删除")
        await self.session.delete(row)
        await self.session.commit()
        return revision

    async def add_model(self, provider_id: str, body: ModelEntryIn) -> tuple[int, ModelEntryOut]:
        provider = await self.get_provider(provider_id)
        if provider.origin == "role_template":
            raise CatalogResourceBusyError("请在全局模板添加模型，或创建自建连接")
        revision = await self.advance_revision(body.expected_catalog_revision)
        count = int(
            (
                await self.session.execute(
                    select(func.count(ModelEntry.id)).where(ModelEntry.provider_id == provider_id)
                )
            ).scalar_one()
        )
        row = ModelEntry(
            owner_user_id=self._owner_user_id(),
            provider_id=provider_id,
            slug=body.slug.strip(),
            label=body.label.strip(),
            description=body.description.strip(),
            capabilities=list(dict.fromkeys(body.capabilities)),
            categories=list(dict.fromkeys(body.categories))
            or categories_for_provider(provider.kind),
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
        if not body.enabled and await self._task_usage().model_active(
            owner_user_id=self._owner_user_id(), model_id=model_id
        ):
            raise CatalogResourceBusyError("模型仍有进行中的任务，暂不能停用模型")
        revision = await self.advance_revision(body.expected_catalog_revision)
        if row.origin == "role_template" and any(
            [
                body.slug.strip() != row.slug,
                body.label != row.label,
                body.description != row.description,
                list(body.capabilities) != row.capabilities,
                list(body.categories) != row.categories,
            ]
        ):
            raise CatalogResourceBusyError("模板管理的模型定义只能在全局设置中修改")
        row.slug = body.slug.strip()
        row.label = body.label.strip()
        row.description = body.description.strip()
        row.capabilities = list(dict.fromkeys(body.capabilities))
        row.categories = list(dict.fromkeys(body.categories)) or categories_for_provider(
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
        if await self._task_usage().model_active(
            owner_user_id=self._owner_user_id(), model_id=model_id
        ):
            raise CatalogResourceBusyError("模型仍有进行中的任务")
        revision = await self.advance_revision(expected)
        await self.session.execute(delete(ModelEntry).where(ModelEntry.id == model_id))
        await self.session.commit()
        return revision

    async def _provider_has_active_tasks(self, provider_id: str) -> bool:
        # Resolve ownership before probing occupancy; foreign IDs remain absent.
        await self.get_provider(provider_id)
        return await self._task_usage().provider_active(
            owner_user_id=self._owner_user_id(), provider_id=provider_id
        )

    async def attach_local_model(self, body):
        model = definition(body.model_id)
        await require_ready(self.session, body.model_id)
        await self.advance_revision(body.expected_catalog_revision)
        owner_user_id = self._owner_user_id()
        provider = await self.session.scalar(
            select(ModelProvider)
            .where(
                ModelProvider.owner_user_id == owner_user_id,
                ModelProvider.kind == "local_qwen_tts",
                ModelProvider.origin == "user",
            )
            .order_by(ModelProvider.id)
        )
        if provider is None:
            supplier = await self.session.scalar(
                select(ModelSupplier).where(
                    ModelSupplier.owner_user_id == owner_user_id, ModelSupplier.name == "Qwen 本地"
                )
            )
            if supplier is None:
                supplier = ModelSupplier(owner_user_id=owner_user_id, name="Qwen 本地")
                self.session.add(supplier)
                await self.session.flush()
            provider = ModelProvider(
                owner_user_id=owner_user_id,
                name="本地 Qwen 语音",
                kind="local_qwen_tts",
                supplier_id=supplier.id,
                base_url="",
                api_key_ciphertext="",
                enabled=True,
            )
            self.session.add(provider)
            await self.session.flush()
        entry = await self.session.scalar(
            select(ModelEntry).where(
                ModelEntry.owner_user_id == owner_user_id,
                ModelEntry.provider_id == provider.id,
                ModelEntry.slug == body.model_id,
            )
        )
        if entry is None:
            self.session.add(
                ModelEntry(
                    owner_user_id=owner_user_id,
                    provider_id=provider.id,
                    slug=body.model_id,
                    label=model["label"],
                    description="本机 MLX 参考录音音色克隆",
                    capabilities=["speech_synthesis"],
                    categories=["speech_synthesis"],
                    enabled=True,
                )
            )
        await self.session.commit()
        return await self.catalog()
