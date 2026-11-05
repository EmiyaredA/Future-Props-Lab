"""Portable templates and checkpoint labels; owner preferences are never exported."""

from copy import deepcopy

from sqlalchemy import select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.knowledge_tools.references import remap_references
from studio.apps.thought_workshop.knowledge_tools.schemas import CheckpointOut, TemplateOut
from studio.apps.thought_workshop.multitable.archive import entity_mapping, remap_state
from studio.apps.thought_workshop.multitable.schemas import Snapshot
from studio.apps.thought_workshop.multitable.storage import asset_ids
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.runtime.ids import new_id


async def export_tools(session, owner_user_id, note_ids, include_templates):
    templates = (
        list(
            await session.scalars(
                select(ThoughtTemplate)
                .where(ThoughtTemplate.owner_user_id == owner_user_id)
                .order_by(ThoughtTemplate.id)
            )
        )
        if include_templates
        else []
    )
    checkpoints = list(
        await session.scalars(
            select(ThoughtCheckpoint)
            .where(ThoughtCheckpoint.note_id.in_(note_ids))
            .order_by(ThoughtCheckpoint.id)
        )
    )
    return {
        "templates": [TemplateOut.model_validate(row).model_dump(mode="json") for row in templates],
        "checkpoints": [
            CheckpointOut.model_validate(row).model_dump(mode="json") for row in checkpoints
        ],
    }


def validate_tools(payload):
    assets = {row["id"] for row in payload["assets"]}
    history = {row["id"]: row for row in payload.get("history", [])}
    for group, schema in (("templates", TemplateOut), ("checkpoints", CheckpointOut)):
        values = payload.get(group, [])
        if not isinstance(values, list) or len(values) > 10000:
            raise ThoughtError("模板或快照清单无效")
        seen = set()
        for value in values:
            row = schema.model_validate(value)
            if row.id in seen:
                raise ThoughtError("模板或快照标识重复")
            seen.add(row.id)
            if (
                group == "templates"
                and not (
                    file_ids(row.document)
                    | (asset_ids(row.multitable) if row.multitable else set())
                )
                <= assets
            ):
                raise ThoughtError("备份缺少模板素材")
            if group == "checkpoints" and (
                row.history_id not in history or history[row.history_id]["note_id"] != row.note_id
            ):
                raise ThoughtError("快照与历史归属无效")


async def import_tools(
    session,
    owner_user_id,
    payload,
    note_mapping,
    history_mapping,
    asset_mapping,
    remap_assets,
    warnings,
    *,
    template_ids,
):
    for value in payload.get("templates", []):
        source = TemplateOut.model_validate(value)
        document = remap_references(source.document, note_mapping, portable=True, warnings=warnings)
        remap_assets(document, asset_mapping)
        state = None
        if source.multitable:
            raw = source.multitable.model_dump(mode="json")
            state = remap_state(
                raw, entity_mapping({"template": {"state": raw}}), note_mapping, asset_mapping
            ).model_dump(mode="json")
        row = ThoughtTemplate(
            id=template_ids[source.id],
            owner_user_id=owner_user_id,
            name=source.name,
            description=source.description,
            document=deepcopy(document),
            kind=source.kind,
            multitable=state,
            tags=source.tags,
            schema_version=3,
            revision=0,
        )
        session.add(row)
        await session.flush()
        session.add_all(
            ThoughtTemplateAsset(template_id=row.id, asset_id=asset)
            for asset in file_ids(document)
            | (asset_ids(Snapshot.model_validate(state)) if state else set())
        )
    for value in payload.get("checkpoints", []):
        source = CheckpointOut.model_validate(value)
        if source.history_id in history_mapping:
            session.add(
                ThoughtCheckpoint(
                    id=new_id(),
                    note_id=note_mapping[source.note_id],
                    history_id=history_mapping[source.history_id],
                    name=source.name,
                    revision=0,
                )
            )
