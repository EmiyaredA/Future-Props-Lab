"""Deletion protection for public files referenced by document projects."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.library import AssetError
from app.runtime.orm_base import Base


async def protect_document_references(session: AsyncSession, asset_ids: list[str]) -> None:
    presentation_refs = Base.metadata.tables.get("presentation_asset_references")
    if presentation_refs is not None and await session.scalar(
        select(presentation_refs.c.project_id)
        .where(presentation_refs.c.asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在被演示文稿使用", code="asset_in_use", status=409)

    history_assets = Base.metadata.tables.get("thought_history_assets")
    if history_assets is not None and await session.scalar(
        select(history_assets.c.history_id).where(history_assets.c.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在被文档历史使用", code="asset_in_use", status=409)

    template_assets = Base.metadata.tables.get("thought_template_assets")
    if template_assets is not None and await session.scalar(
        select(template_assets.c.template_id)
        .where(template_assets.c.asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在被文档模板使用", code="asset_in_use", status=409)

    note_assets = Base.metadata.tables.get("thought_note_assets")
    if note_assets is not None and await session.scalar(
        select(note_assets.c.note_id).where(note_assets.c.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在被文档使用（含回收站）", code="asset_in_use", status=409)

    knowledge_bases = Base.metadata.tables.get("thought_knowledge_bases")
    if knowledge_bases is not None and await session.scalar(
        select(knowledge_bases.c.id).where(knowledge_bases.c.cover_asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在用作知识库封面（含回收站）", code="asset_in_use", status=409)
