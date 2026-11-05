"""Validated account default selections share the catalog CAS revision."""

from sqlalchemy import select

from studio.apps.model_service.catalog.service import ModelCatalogService
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider


async def update_defaults(session, owner_user_id, body, *, defaults_store):
    catalog = ModelCatalogService(session, defaults_store=defaults_store)
    if catalog._owner_user_id() != owner_user_id:
        raise ValueError("默认模型归属与账号上下文不匹配")
    await catalog.advance_revision(body.expected_revision)
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelEntry.provider_id == ModelProvider.id)
            .where(
                ModelEntry.owner_user_id == owner_user_id,
                ModelProvider.owner_user_id == owner_user_id,
            )
        )
    ).all()
    available = {model.id: model for model, provider in rows if model.enabled and provider.enabled}
    for purpose, model_id in body.default_model_ids.items():
        model = available.get(model_id)
        if model is None or purpose not in model.capabilities:
            raise ValueError("默认模型必须来自当前账号，已启用且支持对应能力")
    await defaults_store.replace(owner_user_id=owner_user_id, model_ids=body.default_model_ids)
    await session.commit()
    return await catalog.catalog()
