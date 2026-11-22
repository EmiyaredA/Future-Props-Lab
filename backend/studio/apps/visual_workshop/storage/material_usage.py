"""Conservative inventory of frozen references before a material cleanup."""

import re

from pydantic import BaseModel
from sqlalchemy import select

from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualPrevisScene,
    VisualWorkshopProject,
)


def strings(value):
    if isinstance(value, dict):
        return (
            set().union(*(strings(item) for pair in value.items() for item in pair))
            if value
            else set()
        )
    if isinstance(value, list):
        return set().union(*(strings(item) for item in value)) if value else set()
    if isinstance(value, str):
        return set(re.findall(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", value))
    return set()


class MaterialUsageOut(BaseModel):
    frozen_asset_ids: list[str]
    active_project_ids: list[str]
    project_revisions: dict[str, int]


async def material_usage(session, owner):
    projects = list(
        await session.scalars(
            select(VisualWorkshopProject).where(VisualWorkshopProject.owner_user_id == owner)
        )
    )
    ids = [project.id for project in projects]
    frozen, active = set(), set()
    for row in await session.scalars(
        select(VisualNodeOutput).where(VisualNodeOutput.project_id.in_(ids))
    ):
        frozen |= {item for item in (row.asset_id, row.inspection_asset_id) if item}
        frozen |= strings(row.input_snapshot)
    for row in await session.scalars(
        select(VisualGenerationTask).where(VisualGenerationTask.owner_user_id == owner)
    ):
        frozen |= strings(row.request_payload)
        if row.result_asset_id:
            frozen.add(row.result_asset_id)
        if row.status in {"queued", "submitting", "pending", "processing", "cancelling"}:
            active.add(row.project_id)
    for row in await session.scalars(
        select(VisualGenerationBatch).where(VisualGenerationBatch.owner_user_id == owner)
    ):
        frozen |= strings(row.source_items)
        if row.result_asset_id:
            frozen.add(row.result_asset_id)
        if row.status in {"queued", "processing", "cancelling"}:
            active.add(row.project_id)
    for row in await session.scalars(
        select(VisualPrevisScene).where(VisualPrevisScene.project_id.in_(ids))
    ):
        frozen |= strings(row.document)
    revisions = {
        row.project_id: row.revision
        for row in await session.scalars(
            select(VisualCanvasDocument).where(VisualCanvasDocument.project_id.in_(ids))
        )
    }
    return MaterialUsageOut(
        frozen_asset_ids=sorted(frozen),
        active_project_ids=sorted(active),
        project_revisions=revisions,
    )
