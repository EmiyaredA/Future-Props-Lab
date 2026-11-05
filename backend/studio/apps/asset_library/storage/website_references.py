"""Deletion protection for public files referenced by document projects."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.contracts.asset_library.errors import AssetError
from studio.runtime.database.orm_base import Base


async def protect_document_references(session: AsyncSession, asset_ids: list[str]) -> None:
    outputs = Base.metadata.tables.get("visual_node_outputs")
    if outputs is not None and await session.scalar(
        select(outputs.c.id).where(outputs.c.inspection_asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件被输出版本的透明检查引用", code="asset_in_use", status=409)
    acceptance_refs = Base.metadata.tables.get("visual_acceptance_asset_references")
    if acceptance_refs is not None and await session.scalar(
        select(acceptance_refs.c.owner_id).where(acceptance_refs.c.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件被验收标准或证据引用", code="asset_in_use", status=409)
    sync_assets = Base.metadata.tables.get("thought_sync_assets")
    if sync_assets is not None and await session.scalar(
        select(sync_assets.c.task_id).where(sync_assets.c.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在被文章同步快照使用", code="asset_in_use", status=409)
    presentation_refs = Base.metadata.tables.get("presentation_asset_references")
    if presentation_refs is not None and await session.scalar(
        select(presentation_refs.c.project_id)
        .where(presentation_refs.c.asset_id.in_(asset_ids))
        .limit(1)
    ):
        raise AssetError("文件正在被演示文稿使用", code="asset_in_use", status=409)

    for table_name, owner in (
        ("presentation_template_assets", "template_id"),
        ("presentation_example_assets", "example_id"),
    ):
        table = Base.metadata.tables.get(table_name)
        if table is not None and await session.scalar(
            select(table.c[owner]).where(table.c.asset_id.in_(asset_ids)).limit(1)
        ):
            raise AssetError("文件正在被演示模板或示例使用", code="asset_in_use", status=409)

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

    publications = Base.metadata.tables.get("thought_publications")
    if publications is not None and await session.scalar(
        select(publications.c.id).where(publications.c.cover_asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError("文件正在用作社区发布封面（含撤回配置）", code="asset_in_use", status=409)

    table_assets = Base.metadata.tables.get("thought_data_assets")
    if table_assets is not None and await session.scalar(
        select(table_assets.c.note_id).where(table_assets.c.asset_id.in_(asset_ids)).limit(1)
    ):
        raise AssetError(
            "文件正在被多维表格使用（含历史和回收站）", code="asset_in_use", status=409
        )
