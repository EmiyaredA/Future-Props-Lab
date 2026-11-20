"""Submit a revision-bound card generation through an atomic binding port."""

from collections.abc import Awaitable, Callable
from typing import Protocol

from studio.apps.visual_workshop.generation_errors import GenerationError
from studio.apps.visual_workshop.schemas.creative_workflow import CardOut
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskOut
from studio.contracts.model_service.generation_tasks import ImageGenerationTaskCreateIn
from studio.runtime.project_errors import ProjectResourceError


class CardGenerationRecords(Protocol):
    async def existing(self) -> GenerationTaskOut | None: ...
    async def current(self) -> CardOut: ...
    async def complete(self, task_id: str) -> None: ...
    async def reset(self) -> None: ...


class CardGeneration:
    def __init__(self, store: CardGenerationRecords, project_id: str, body):
        self.store, self.project_id, self.body = store, project_id, body

    async def run(self, submit: Callable[..., Awaitable]):
        prior = await self.store.existing()
        if prior is not None:
            return prior
        row = await self.store.current()
        parent = row.parent_asset_id
        arguments = ImageGenerationTaskCreateIn(
            kind="image",
            model_id=self.body.model_id,
            prompt=self.body.prompt,
            size=self.body.size,
            reference_asset_ids=[parent] if parent else [],
        )
        await self.store.reset()
        try:
            return await submit(self.project_id, arguments, on_created=self.store.complete)
        except (ProjectResourceError, GenerationError) as exc:
            await self.store.reset()
            if exc.status == 409:
                prior = await self.store.existing()
                if prior is not None:
                    return prior
            raise
