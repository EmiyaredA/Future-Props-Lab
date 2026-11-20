"""Stage card binding and receipt in the generation intake's transaction."""

from studio.apps.visual_workshop.creative_rules import validate_card_generation
from studio.apps.visual_workshop.generation_common import generation_task_out
from studio.apps.visual_workshop.schemas.card_generation import (
    CardGenerationBinding,
    CardGenerationReceipt,
)
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords, card_out
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.runtime.database.operation_receipts import OperationError, record, replay
from studio.runtime.project_errors import ProjectResourceError


def card_generation_resource_id(project_id):
    return f"card-generation:{project_id}"


class SqlCardGeneration:
    def __init__(self, session, owner, project_id, card_id, body):
        self.session = session
        self.workflow = SqlCreativeRecords(session, owner)
        self.project_id, self.card_id = project_id, card_id
        self.body = body
        self.scope = dict(
            owner_user_id=owner,
            kind="visual",
            resource_id=card_generation_resource_id(project_id),
            body=CardGenerationBinding(card_id=card_id, **body.model_dump()),
        )

    async def existing(self):
        await self.workflow.card_row(self.project_id, self.card_id)
        try:
            result = await replay(self.session, **self.scope)
        except OperationError as exc:
            raise ProjectResourceError(str(exc), exc.code, exc.status) from None
        if result is None:
            return None
        row = await self.session.get(VisualGenerationTask, result["task_id"])
        if row is None or row.project_id != self.project_id:
            raise ProjectResourceError("生成任务已不可用")
        return generation_task_out(row)

    async def current_row(self):
        row = await self.workflow.card_row(self.project_id, self.card_id)
        validate_card_generation(card_out(row), self.body.expected_revision)
        return row

    async def complete(self, task_id):
        row = await self.current_row()
        row.data = {
            **row.data,
            "candidate_task_ids": [*row.data.get("candidate_task_ids", []), task_id],
        }
        row.revision += 1
        record(self.session, **self.scope, result=CardGenerationReceipt(task_id=task_id))

    async def current(self):
        return card_out(await self.current_row())

    async def reset(self):
        await self.session.rollback()
