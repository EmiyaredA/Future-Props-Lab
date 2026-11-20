"""Generation planning depends on snapshots, atomic storage and preparation ports."""

from collections.abc import Awaitable, Callable
from typing import Protocol

from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchOut,
    ImageGenerationBatchCreateIn,
)
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskOut
from studio.contracts.model_service.generation_tasks import GenerationTaskCreateIn
from studio.contracts.visual_workshop.visual_generation import (
    GenerationAssets,
    VisualModelSelection,
    VisualReferenceRules,
)
from studio.contracts.visual_workshop.visual_generation_plan import GenerationPlan

CreatedBinding = Callable[[str], Awaitable[None]]
ReferenceDelivery = Callable[[str], Awaitable[None]]


class GenerationPreparation(Protocol):
    async def model(self, body: GenerationTaskCreateIn) -> VisualModelSelection: ...
    async def assets(
        self, project: str, identity: str, references: set[str]
    ) -> GenerationAssets: ...
    async def prepare(self, plan: GenerationPlan) -> dict[str, dict]: ...


class GenerationIntakeStore(Protocol):
    async def pending(self, project: str) -> list[str]: ...
    async def resolve(
        self, project: str, arguments: GenerationTaskCreateIn, rules: VisualReferenceRules
    ) -> tuple[GenerationTaskCreateIn, dict[str, str], list[dict]]: ...
    async def start(self, plan: GenerationPlan) -> None: ...
    async def commit(
        self,
        plan: GenerationPlan,
        payloads: dict[str, dict],
        arguments: GenerationTaskCreateIn,
        batch: ImageGenerationBatchCreateIn | None,
        on_created: CreatedBinding | None,
    ) -> GenerationTaskOut | GenerationBatchOut: ...
    async def abort(self, identity: str) -> None: ...
