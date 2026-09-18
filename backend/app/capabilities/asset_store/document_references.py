"""Deletion protection for public files referenced by document projects."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.library import AssetError
from app.models.thought_workshop import ThoughtHistoryAsset, ThoughtKnowledgeBase, ThoughtNoteAsset
from app.runtime.orm_base import Base


async def protect_document_references(session: AsyncSession, asset_ids: list[str]) -> None:
    presentation_refs = Base.metadata.tables.get("presentation_asset_references")
    if presentation_refs is not None and await session.scalar(
        select(presentation_refs.c.project_id)
        .where(presentation_refs.c.asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在被演示文稿使用", code="asset_in_use", status=409)
    if await session.scalar(
        select(ThoughtHistoryAsset.history_id)
        .where(ThoughtHistoryAsset.asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在被文档历史使用", code="asset_in_use", status=409)
    if await session.scalar(
        select(ThoughtNoteAsset.note_id).where(ThoughtNoteAsset.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在被文档使用（含回收站）", code="asset_in_use", status=409)
    if await session.scalar(
        select(ThoughtKnowledgeBase.id)
        .where(ThoughtKnowledgeBase.cover_asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在用作知识库封面（含回收站）", code="asset_in_use", status=409)
