"""Verify frozen Canvas history and export retained files for Assets."""

from collections import defaultdict
from uuid import uuid5

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from studio.apps.visual_workshop.canvas_asset_values import existing_assets
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.schemas.workshop import (
    VisualAssistantAssetPart,
    VisualAssistantContentPart,
)
from studio.apps.visual_workshop.storage.migration_records import DATASETS
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.contracts.visual_workshop.visual_migration import (
    CANVAS_PINS_DATASET,
    CONVERSATION_PINS_DATASET,
    CanvasPinBatch,
    CanvasPinPage,
    CanvasPins,
    ConversationPinBatch,
    ConversationPinPage,
    ConversationPins,
)
from studio.runtime.database.project_history_migration import blocked, inventory

from .migration_assistant import DATASETS as ASSISTANT_DATASETS

CONTENT_PARTS = TypeAdapter(list[VisualAssistantContentPart])


async def inventory_pins(sessions, plan):
    return await inventory(sessions, plan, DATASETS[1])


async def canvas_pins(session, row):
    outputs = list(
        await session.scalars(
            select(VisualNodeOutput).where(VisualNodeOutput.project_id == row.project_id)
        )
    )
    output_ids = {output.id: output for output in outputs}
    task_ids = {
        identity
        for identity in (
            *(output.generation_task_id for output in outputs),
            *(node.get("generation_task_id") for node in row.nodes),
        )
        if identity
    }
    if task_ids:
        actual = set(
            await session.scalars(
                select(VisualGenerationTask.id).where(
                    VisualGenerationTask.id.in_(task_ids),
                    VisualGenerationTask.project_id == row.project_id,
                    VisualGenerationTask.owner_user_id == session.info["owner_user_id"],
                )
            )
        )
        if actual != task_ids:
            raise blocked("migration_visual_generation_source_missing")
    for node in row.nodes:
        if selected := node.get("final_output_id"):
            output = output_ids.get(selected)
            if (
                output is None
                or output.node_id != node["id"]
                or (
                    node.get("final_version") is not None
                    and output.version != node["final_version"]
                )
            ):
                raise blocked("migration_canvas_output_conflict")
    return sorted(
        existing_assets(row.nodes)
        | {
            asset_id
            for output in outputs
            for asset_id in (
                output.asset_id,
                output.inspection_asset_id,
                *(item.get("asset_id") for item in output.input_snapshot or ()),
            )
            if asset_id
        }
    )


async def export_canvas_pins(sessions, plan, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as session:
        rows = list(
            await session.scalars(
                select(VisualCanvasDocument)
                .join(
                    VisualWorkshopProject,
                    VisualWorkshopProject.id == VisualCanvasDocument.project_id,
                )
                .where(
                    VisualWorkshopProject.owner_user_id == str(owner),
                    VisualCanvasDocument.project_id > (after or ""),
                )
                .order_by(VisualCanvasDocument.project_id)
                .limit(2)
            )
        )
        records = [
            CanvasPins(
                id=row.project_id, revision=row.revision, asset_ids=await canvas_pins(session, row)
            )
            for row in rows[:1]
        ]
    batch = CanvasPinBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=CANVAS_PINS_DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{CANVAS_PINS_DATASET}/{owner}/{after or ''}"),
        records=tuple(records),
    )
    return CanvasPinPage(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
    )


async def inventory_conversation_pins(sessions, plan):
    return await inventory(sessions, plan, ASSISTANT_DATASETS[0])


async def conversation_assets(session, conversation_id):
    attached = defaultdict(set)
    for message_id, asset_id in await session.execute(
        select(VisualAssistantMessageAsset.message_id, VisualAssistantMessageAsset.asset_id)
        .join(
            VisualAssistantMessage,
            VisualAssistantMessage.id == VisualAssistantMessageAsset.message_id,
        )
        .where(VisualAssistantMessage.conversation_id == conversation_id)
    ):
        attached[message_id].add(asset_id)
    for identity, parts in await session.execute(
        select(VisualAssistantMessage.id, VisualAssistantMessage.content_parts).where(
            VisualAssistantMessage.conversation_id == conversation_id
        )
    ):
        if parts:
            try:
                used = {
                    part.asset_id
                    for part in CONTENT_PARTS.validate_python(parts)
                    if isinstance(part, VisualAssistantAssetPart)
                }
            except ValidationError:
                raise blocked("migration_visual_message_parts_invalid") from None
            if used != attached[identity]:
                raise blocked("migration_visual_message_attachment_conflict")
    return sorted(set().union(*attached.values()))


async def export_conversation_pins(sessions, plan, owner, after):
    dataset = ASSISTANT_DATASETS[0]
    async with sessions(info={"owner_user_id": str(owner)}) as session:
        rows = list(
            await session.scalars(
                dataset.select(VisualAssistantConversation)
                .where(
                    dataset.owner_column == str(owner),
                    VisualAssistantConversation.id > (after or ""),
                )
                .order_by(VisualAssistantConversation.id)
                .limit(2)
            )
        )
        try:
            records = tuple(
                [
                    ConversationPins(
                        id=row.id,
                        project_id=row.project_id,
                        revision=row.revision,
                        asset_ids=await conversation_assets(session, row.id),
                    )
                    for row in rows[:1]
                ]
            )
        except ValidationError:
            raise blocked("migration_visual_conversation_pins_invalid") from None
    batch = ConversationPinBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=CONVERSATION_PINS_DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{CONVERSATION_PINS_DATASET}/{owner}/{after or ''}"),
        records=records,
    )
    return ConversationPinPage(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
    )
