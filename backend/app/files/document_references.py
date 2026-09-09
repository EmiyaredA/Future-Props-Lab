"""Deletion protection for public files referenced by document projects."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.files.library import AssetError
from app.models.thought_workshop import ThoughtKnowledgeBase, ThoughtNoteAsset


async def protect_document_references(session: AsyncSession, asset_ids: list[str]) -> None:
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
