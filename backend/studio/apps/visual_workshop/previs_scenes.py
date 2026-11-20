"""Versioned, self-contained TrumanMap scenes owned by a Visual project."""

import json
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, field_validator
from sqlalchemy import delete, func, select, text, update

from studio.apps.visual_workshop.creative_assets import (
    model_id,
    require_project_assets,
    scene_model_assets,
)
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.schemas.creative_workflow import ScriptSource
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.apps.visual_workshop.storage.models import VisualPrevisScene
from studio.runtime.files.project_archives import ProjectSnapshotError
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.time import utc_now

SCENES_PER_PROJECT = 100
SCENE_BYTES = 2 * 1024 * 1024
SceneTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class PrevisDocument(BaseModel):
    """Store the upstream editor document, with no external file or URL handles."""

    model_config = ConfigDict(extra="forbid")
    format_version: Literal[1]
    document: dict

    @field_validator("document")
    @classmethod
    def validate_document(cls, value):
        pending = [(value, 0)]
        while pending:
            item, depth = pending.pop()
            if depth > 40:
                raise ValueError("预演场景嵌套过深")
            if isinstance(item, dict):
                asset = item.get("asset")
                if isinstance(asset, dict) and any(
                    asset.get(key) for key in ("url", "provider", "kiln", "sourceUrl", "thumbnail")
                ):
                    raise ValueError("只支持内置预演素材和已上传的项目模型")
                if (
                    isinstance(asset, dict)
                    and asset.get("path")
                    and (
                        not model_id(asset["path"])
                        or asset.get("kind") != "model"
                        or any(asset.get(key) for key in ("model", "blueprint", "recipe"))
                    )
                ):
                    raise ValueError("项目预演模型引用无效")
                pending.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
        try:
            size = len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode())
        except (TypeError, ValueError, UnicodeError) as exc:
            raise ValueError("预演场景 JSON 无效") from exc
        if size > SCENE_BYTES:
            raise ValueError("预演场景不能超过 2 MiB")
        view = value.get("view")
        if (
            value.get("version") != 1
            or not isinstance(value.get("objects"), list)
            or not isinstance(value.get("gridVisible"), bool)
            or not isinstance(view, dict)
            or any(not isinstance(view.get(key), dict) for key in ("position", "target"))
        ):
            raise ValueError("预演场景格式不受支持")
        return value


class PrevisSceneCreate(PrevisDocument):
    title: SceneTitle
    script_source: ScriptSource | None = None


class PrevisSceneUpdate(PrevisSceneCreate):
    expected_revision: int = Field(ge=0)


class PrevisSceneSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    revision: int
    updated_at: datetime


class PrevisSceneOut(PrevisSceneSummary, PrevisSceneCreate):
    pass


async def scene_rows(session, project_id):
    return list(
        await session.scalars(
            select(VisualPrevisScene)
            .where(VisualPrevisScene.project_id == project_id)
            .order_by(VisualPrevisScene.created_at, VisualPrevisScene.id)
        )
    )


class PrevisScenes:
    def __init__(self, session, owner, inspect_assets=None):
        self.session = session
        self.projects = Projects(session, owner)
        self.workflow = CreativeWorkflow(SqlCreativeRecords(session, owner))
        self.inspect_assets = inspect_assets

    async def list(self, project_id):
        await self.projects.row(project_id)
        model = VisualPrevisScene
        rows = await self.session.execute(
            select(model.id, model.title, model.revision, model.updated_at)
            .where(model.project_id == project_id)
            .order_by(model.created_at, model.id)
        )
        return [PrevisSceneSummary.model_validate(row) for row in rows]

    async def get(self, project_id, scene_id):
        await self.projects.row(project_id)
        return await self._scene(project_id, scene_id)

    async def _scene(self, project_id, scene_id):
        row = await self.session.get(VisualPrevisScene, scene_id, populate_existing=True)
        if row is None or row.project_id != project_id:
            raise ProjectResourceError("预演场景不存在")
        return row

    async def check_models(self, project_id, document):
        models = scene_model_assets(document)
        if not models:
            return
        await self.projects.row(project_id)
        await require_project_assets(project_id, inspect=self.inspect_assets, models=models)
        await self.session.rollback()

    async def create(self, project_id, body):
        await self.check_models(project_id, body.document)
        await self.session.execute(text("BEGIN IMMEDIATE"))
        await self.projects.row(project_id)
        await self.workflow.check_source(project_id, body.script_source)
        count = await self.session.scalar(
            select(func.count())
            .select_from(VisualPrevisScene)
            .where(VisualPrevisScene.project_id == project_id)
        )
        if count >= SCENES_PER_PROJECT:
            raise ProjectResourceError("项目最多可创建 100 个预演场景", "previs_scene_limit", 409)
        row = VisualPrevisScene(project_id=project_id, **body.model_dump())
        self.session.add(row)
        await self.session.flush()
        result = PrevisSceneOut.model_validate(row)
        await self.session.commit()
        return result

    async def change(self, project_id, scene_id, expected_revision, body=None):
        if body is not None:
            await self.check_models(project_id, body.document)
        await self.session.execute(text("BEGIN IMMEDIATE"))
        current = await self.get(project_id, scene_id)
        if current.revision != expected_revision:
            return PrevisSceneOut.model_validate(current), True
        predicate = (
            VisualPrevisScene.id == scene_id,
            VisualPrevisScene.project_id == project_id,
            VisualPrevisScene.revision == expected_revision,
        )
        if body is None:
            await self.session.execute(delete(VisualPrevisScene).where(*predicate))
            result = None
        else:
            statement = (
                update(VisualPrevisScene)
                .where(*predicate)
                .values(
                    **body.model_dump(exclude={"expected_revision", "script_source"}),
                    revision=expected_revision + 1,
                    updated_at=utc_now(),
                )
                .returning(VisualPrevisScene)
            )
            result = PrevisSceneOut.model_validate((await self.session.scalars(statement)).one())
        await self.session.commit()
        return result, False


async def export_scenes(session, project_id):
    return [
        PrevisSceneCreate.model_validate(row, from_attributes=True).model_dump(mode="json")
        for row in await scene_rows(session, project_id)
    ]


def import_scenes(payload):
    try:
        return TypeAdapter(
            Annotated[list[PrevisSceneCreate], Field(max_length=SCENES_PER_PROJECT)]
        ).validate_python(payload.get("previs_scenes", []))
    except ValueError as exc:
        raise ProjectSnapshotError("视觉项目快照的预演场景无效") from exc
