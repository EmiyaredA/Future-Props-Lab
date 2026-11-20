"""Project scripts and account-owned visual design cards."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import exists, func, select, text

from studio.apps.visual_workshop.creative_assets import MODEL_MIME, model_id
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualScript,
)
from studio.runtime.project_errors import ProjectResourceError

Identifier = Annotated[
    str, StringConstraints(pattern=r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
LongText = Annotated[str, StringConstraints(max_length=12_000)]


class WorkflowModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScriptScene(WorkflowModel):
    id: Identifier
    title: Title
    heading: Annotated[str, StringConstraints(max_length=240)] = ""
    text: LongText = ""


class ScriptEpisode(WorkflowModel):
    id: Identifier
    title: Title
    scenes: list[ScriptScene] = Field(default_factory=list, max_length=200)


class ScriptDocument(WorkflowModel):
    episodes: list[ScriptEpisode] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_document(self):
        ids = [episode.id for episode in self.episodes]
        scenes = [scene for episode in self.episodes for scene in episode.scenes]
        ids.extend(scene.id for scene in scenes)
        if len(ids) != len(set(ids)):
            raise ValueError("集与场的标识不能重复")
        if len(self.model_dump_json().encode()) > 2 * 1024 * 1024:
            raise ValueError("剧本文档不能超过 2 MiB")
        return self


class ScriptUpdate(ScriptDocument):
    expected_revision: int = Field(ge=0)


class ScriptOut(ScriptDocument):
    revision: int = Field(ge=0)


class ScriptSource(WorkflowModel):
    scene_id: Identifier
    revision: int = Field(ge=0)


class CardData(WorkflowModel):
    kind: Literal["character", "scene", "prop"]
    title: Title
    facts: LongText = ""
    design: LongText = ""
    proposed_design: LongText = ""
    source: ScriptSource | None = None
    parent_id: Identifier | None = None
    parent_asset_id: Identifier | None = None
    candidate_task_ids: list[Identifier] = Field(default_factory=list, max_length=80)
    candidate_asset_ids: list[Identifier] = Field(default_factory=list, max_length=80)
    adopted_asset_id: Identifier | None = None
    model_asset_key: Annotated[str, StringConstraints(max_length=180)] | None = None
    archived: bool = False


class CardUpdate(CardData):
    expected_revision: int = Field(ge=0)


class CardOut(CardData):
    id: Identifier
    revision: int = Field(ge=0)
    source_project_id: str | None = None
    media_projects: dict[str, str | None] = Field(default_factory=dict)


def card_out(row):
    return CardOut(
        id=row.id,
        revision=row.revision,
        source_project_id=row.project_id,
        media_projects=row.media_projects,
        **row.data,
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


class CreativeWorkflow:
    def __init__(self, session, owner, inspect_assets=None):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)
        self.inspect_assets = inspect_assets

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
        current = await self.script(project_id)
        if current.revision != body.expected_revision:
            raise ProjectResourceError("剧本已在其他窗口更新", "visual_script_conflict", 409)
        episodes = [episode.model_dump() for episode in body.episodes]
        row = await self.session.get(VisualScript, project_id)
        if row is None:
            self.session.add(VisualScript(project_id=project_id, episodes=episodes, revision=1))
        else:
            row.episodes, row.revision = episodes, current.revision + 1
        await self.session.commit()
        return ScriptOut(episodes=body.episodes, revision=current.revision + 1)

    async def check_source(self, project_id, source):
        if source is None:
            return
        script = await self.script(project_id)
        if script.revision != source.revision or not any(
            scene.id == source.scene_id for episode in script.episodes for scene in episode.scenes
        ):
            raise ProjectResourceError(
                "来源剧本已经变化，请重新读取", "visual_script_conflict", 409
            )

    async def cards(self, project_id=None):
        if project_id is not None:
            await self.projects.row(project_id)
        rows = await self.session.scalars(
            select(VisualAssetCard)
            .where(VisualAssetCard.owner_user_id == self.owner)
            .order_by(VisualAssetCard.id)
        )
        return [card_out(row) for row in rows]

    async def card_row(self, project_id, card_id):
        if project_id is not None:
            await self.projects.row(project_id)
        row = await self.session.get(VisualAssetCard, card_id, populate_existing=True)
        if row is None or row.owner_user_id != self.owner:
            raise ProjectResourceError("设定卡不存在")
        return row

    async def validate_card(self, project_id, data, previous):
        parent_id = data.parent_id
        inherited_source = False
        if previous is not None and (
            previous.kind != data.kind
            or previous.parent_id != parent_id
            or previous.parent_asset_id != data.parent_asset_id
        ):
            raise ProjectResourceError("卡片类型和父版本在创建后固定", "visual_card_parent", 422)
        if parent_id and previous is None:
            parent = card_out(await self.card_row(project_id, parent_id))
            if (
                parent.kind != data.kind
                or parent.archived
                or not parent.adopted_asset_id
                or parent.adopted_asset_id != data.parent_asset_id
            ):
                raise ProjectResourceError("请选择已有采用图的同类父卡", "visual_card_parent", 422)
            inherited_source = parent.source == data.source
        if not inherited_source and (previous is None or previous.source != data.source):
            if data.source is not None and project_id is None:
                raise ProjectResourceError("请从来源项目的剧本提取设定", "visual_card_source", 422)
            await self.check_source(project_id, data.source)
        if data.parent_asset_id and not parent_id:
            raise ProjectResourceError("父图需要关联父卡", "visual_card_parent", 422)
        old_tasks = set(previous.candidate_task_ids if previous else [])
        if set(data.candidate_task_ids) != old_tasks:
            raise ProjectResourceError("候选任务须通过设定卡生成", "visual_card_reference", 422)

    async def save_card(self, project_id, data, card_id=None):
        images = set(
            filter(None, [data.adopted_asset_id, data.parent_asset_id, *data.candidate_asset_ids])
        )
        models = set()
        if data.model_asset_key:
            identity = model_id(data.model_asset_key)
            if identity is None:
                raise ProjectResourceError("3D 模型标识无效", "visual_asset_scope", 422)
            models.add(identity)
        identities = images | models
        if project_id is not None:
            await self.projects.row(project_id)
        if card_id:
            await self.card_row(project_id, card_id)
        if identities and self.inspect_assets is None:
            raise ProjectResourceError("设定素材校验未配置", "visual_asset_scope_unavailable", 503)
        found = await self.inspect_assets(None, identities) if identities else {}
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        project = await self.projects.row(project_id) if project_id is not None else None
        row = await self.card_row(project_id, card_id) if card_id else None
        if row is not None and row.revision != data.expected_revision:
            raise ProjectResourceError("设定卡已在其他窗口更新", "visual_card_conflict", 409)
        await self.validate_card(project_id, data, card_out(row) if row else None)
        previous_media = row.media_projects if row else {}
        media = {}
        for identity in identities:
            if item := found.get(identity):
                kind, mime, scope = item
                if (identity not in images or kind == "image") and (
                    identity not in models or mime == MODEL_MIME
                ):
                    media[identity] = scope
                    continue
            elif identity in previous_media:
                media[identity] = previous_media[identity]
                continue
            raise ProjectResourceError(
                "素材已删除、类型不符或不属于当前账号", "visual_asset_scope", 422
            )
        for scope in {scope for scope in media.values() if scope is not None}:
            await self.projects.row(scope)
        payload = data.model_dump(exclude={"expected_revision"})
        source_project = row.project_id if row else None
        if data.source and (row is None or row.data.get("source") != payload["source"]):
            if data.parent_id and row is None:
                parent = await self.card_row(None, data.parent_id)
                if parent.data.get("source") == payload["source"]:
                    source_project = parent.project_id
                elif project:
                    source_project = project.id
            elif project:
                source_project = project.id
        if not data.source:
            source_project = None
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
            row = VisualAssetCard(
                owner_user_id=self.owner,
                project_id=source_project,
                data=payload,
                media_projects=media,
            )
            self.session.add(row)
        else:
            row.revision += 1
            row.data = payload
            row.project_id = source_project
            row.media_projects = media
        await self.session.flush()
        result = card_out(row)
        await self.session.commit()
        return result
