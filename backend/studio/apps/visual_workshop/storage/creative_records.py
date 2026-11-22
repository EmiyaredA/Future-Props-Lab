"""Owner-bound creative records; each write owns one short SQLite transaction."""

from sqlalchemy import exists, func, select, text

from studio.apps.visual_workshop.creative_ports import CardEditContext
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.schemas.creative_workflow import (
    CardOut,
    ScriptOut,
    current_card_data,
)
from studio.apps.visual_workshop.storage.models import VisualAssetCard, VisualScript
from studio.runtime.project_errors import ProjectResourceError


class SqlCreativeRecords:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)

    async def require_project(self, project_id):
        await self.projects.row(project_id)

    async def script(self, project_id):
        await self.projects.row(project_id)
        row = await self.session.get(VisualScript, project_id, populate_existing=True)
        return (
            ScriptOut(episodes=row.episodes, revision=row.revision)
            if row
            else ScriptOut(revision=0)
        )

    async def update_script(self, project_id, body):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            current = await self.script(project_id)
            if current.revision != body.expected_revision:
                raise ProjectResourceError("剧本已在其他窗口更新", "visual_script_conflict", 409)
            row = await self.session.get(VisualScript, project_id)
            episodes = [episode.model_dump() for episode in body.episodes]
            if row is None:
                self.session.add(VisualScript(project_id=project_id, episodes=episodes, revision=1))
            else:
                row.episodes, row.revision = episodes, current.revision + 1
            await self.session.commit()
            return ScriptOut(episodes=body.episodes, revision=current.revision + 1)
        except BaseException:
            await self.session.rollback()
            raise

    async def cards(self, project_id=None):
        project_cards = None
        if project_id is not None:
            project_cards = set((await self.projects.canvas_row(project_id)).project_card_ids or [])
        rows = await self.session.scalars(
            select(VisualAssetCard)
            .where(VisualAssetCard.owner_user_id == self.owner)
            .order_by(VisualAssetCard.id)
        )
        return [card_out(row) for row in rows if project_cards is None or row.id in project_cards]

    async def card_row(self, project_id, card_id):
        if project_id is not None:
            await self.projects.row(project_id)
        row = await self.session.get(VisualAssetCard, card_id, populate_existing=True)
        if row is None or row.owner_user_id != self.owner:
            raise ProjectResourceError("设定卡不存在")
        return row

    async def card(self, project_id, card_id):
        return card_out(await self.card_row(project_id, card_id))

    async def edit_card(self, project_id, data, card_id, transform):
        # Inspection may have used this request's read transaction. End it before
        # taking the write lock and re-read every fact used by the business rule.
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            if project_id is not None:
                await self.projects.row(project_id)
            row = await self.card_row(project_id, card_id) if card_id else None
            if row is not None and row.revision != data.expected_revision:
                raise ProjectResourceError("设定卡已在其他窗口更新", "visual_card_conflict", 409)
            parent = (
                await self.card(None, data.parent_id) if data.parent_id and row is None else None
            )
            previous = card_out(row) if row else None
            needs_source = data.source is not None and (
                previous is None or previous.source != data.source
            )
            inherited_source = parent is not None and parent.source == data.source
            script = (
                await self.script(project_id)
                if needs_source and not inherited_source and project_id
                else ScriptOut(revision=0)
            )
            prepared = transform(CardEditContext(card_out(row) if row else None, parent, script))
            for scope in set(prepared.media_projects.values()) - {None}:
                await self.projects.row(scope)
            if row is None:
                count = await self.session.scalar(
                    select(func.count())
                    .select_from(VisualAssetCard)
                    .where(VisualAssetCard.owner_user_id == self.owner)
                )
                if count >= 500:
                    raise ProjectResourceError(
                        "设定库最多可创建 500 张设定卡", "visual_card_limit", 409
                    )
                row = VisualAssetCard(owner_user_id=self.owner)
                self.session.add(row)
            else:
                row.revision += 1
            row.data = prepared.data.model_dump()
            row.project_id = prepared.source_project_id
            row.media_projects = prepared.media_projects
            await self.session.flush()
            result = card_out(row)
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            raise


def card_out(row):
    return CardOut(
        id=row.id,
        revision=row.revision,
        source_project_id=row.project_id,
        media_projects=row.media_projects,
        **current_card_data(row.data),
    )


async def require_project_card_media_clear(session, owner, project_id):
    media = func.json_each(VisualAssetCard.media_projects).table_valued("key", "value")
    linked = await session.scalar(
        select(VisualAssetCard.id)
        .where(
            VisualAssetCard.owner_user_id == owner,
            exists(select(1).select_from(media).where(media.c.value == project_id)),
        )
        .limit(1)
    )
    if linked is not None:
        raise ProjectResourceError(
            "有通用设定卡正在引用此项目的原件，请先在设定库解除或替换这些引用",
            "visual_card_media_in_use",
            409,
        )
