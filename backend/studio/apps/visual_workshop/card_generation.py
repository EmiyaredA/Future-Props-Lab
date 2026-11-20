"""Bind one paid generation task to a design card and its exact draft revision."""

from collections.abc import Awaitable, Callable
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from studio.apps.visual_workshop.creative_workflow import (
    CreativeWorkflow,
    Identifier,
    WorkflowModel,
)
from studio.apps.visual_workshop.generation_common import GenerationError, generation_task_out
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.contracts.model_service.generation_tasks import ImageGenerationTaskCreateIn
from studio.runtime.database.operation_receipts import OperationError, record, replay
from studio.runtime.project_errors import ProjectResourceError


class CardGenerationIn(WorkflowModel):
    request_id: Identifier
    expected_revision: int = Field(ge=0)
    model_id: str
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]
    size: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class CardGenerationReceipt(BaseModel):
    task_id: str


class CardGenerationBinding(CardGenerationIn):
    card_id: Identifier


def card_generation_resource_id(project_id):
    return f"card-generation:{project_id}"


class CardGeneration:
    def __init__(self, session, owner, project_id, card_id, body):
        self.session = session
        self.workflow = CreativeWorkflow(session, owner)
        self.project_id, self.card_id = project_id, card_id
        self.body = body
        self.scope = dict(
            owner_user_id=owner,
            kind="visual",
            resource_id=card_generation_resource_id(project_id),
            body=CardGenerationBinding(card_id=card_id, **body.model_dump()),
        )

    async def existing(self):
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

    async def current(self):
        row = await self.workflow.card_row(self.project_id, self.card_id)
        if row.revision != self.body.expected_revision or row.data.get("archived"):
            raise ProjectResourceError("设定卡已更新，请保存后重试", "visual_card_conflict", 409)
        if len(row.data.get("candidate_task_ids", [])) >= 80:
            raise ProjectResourceError(
                "设定卡最多保留 80 个生成任务", "visual_card_task_limit", 409
            )
        return row

    async def complete(self, task_id):
        row = await self.current()
        row.data = {
            **row.data,
            "candidate_task_ids": [*row.data.get("candidate_task_ids", []), task_id],
        }
        row.revision += 1
        record(self.session, **self.scope, result=CardGenerationReceipt(task_id=task_id))

    async def run(self, submit: Callable[..., Awaitable]):
        await self.workflow.card_row(self.project_id, self.card_id)
        prior = await self.existing()
        if prior is not None:
            return prior
        row = await self.current()
        parent = row.data.get("parent_asset_id")
        arguments = ImageGenerationTaskCreateIn(
            kind="image",
            model_id=self.body.model_id,
            prompt=self.body.prompt,
            size=self.body.size,
            reference_asset_ids=[parent] if parent else [],
        )
        await self.session.rollback()
        try:
            return await submit(self.project_id, arguments, on_created=self.complete)
        except (ProjectResourceError, GenerationError) as exc:
            await self.session.rollback()
            if exc.status == 409:
                prior = await self.existing()
                if prior is not None:
                    return prior
            raise
