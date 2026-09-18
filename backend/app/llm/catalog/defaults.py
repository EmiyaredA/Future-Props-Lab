"""Validated workspace default selections share the catalog CAS revision."""

from sqlalchemy import select

from app.console.models.platform_governance import PlatformSetting
from app.llm.catalog.service import ModelCatalogService
from app.llm.models import ModelEntry, ModelProvider


async def update_defaults(session, workspace_id, body):
    await ModelCatalogService(session)._bump(body.expected_revision)
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelEntry.provider_id == ModelProvider.id)
            .where(
                ModelEntry.workspace_id == workspace_id, ModelProvider.workspace_id == workspace_id
            )
        )
    ).all()
    available = {model.id: model for model, provider in rows if model.enabled and provider.enabled}
    for purpose, model_id in body.default_model_ids.items():
        model = available.get(model_id)
        if model is None or purpose not in model.capabilities:
            raise ValueError("默认模型必须来自当前空间，已启用且支持对应能力")
    key = f"workspace_defaults:{workspace_id}"
    row = await session.get(PlatformSetting, key)
    if row:
        row.payload = body.default_model_ids
        row.revision += 1
    else:
        session.add(PlatformSetting(id=key, payload=body.default_model_ids, revision=1))
    await session.commit()
    return await ModelCatalogService(session).catalog()
