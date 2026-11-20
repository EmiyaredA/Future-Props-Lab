"""Freeze inputs and orchestrate generation through explicit, replaceable ports."""

from uuid import uuid4

from pydantic import ValidationError

from studio.apps.visual_workshop.generation.intake_ports import (
    GenerationIntakeStore,
    GenerationPreparation,
    ReferenceDelivery,
)
from studio.apps.visual_workshop.generation_errors import GenerationError
from studio.contracts.model_service.generation_tasks import ImageGenerationTaskCreateIn
from studio.contracts.visual_workshop.visual_generation_plan import (
    GenerationPlan,
    TaskPlan,
    reference_ids,
)


class GenerationIntake:
    def __init__(
        self,
        store: GenerationIntakeStore,
        peer: GenerationPreparation,
        deliver_reference: ReferenceDelivery,
    ):
        self.store, self.peer, self.deliver_reference = store, peer, deliver_reference

    async def create_task(self, project, body, *, on_created=None):
        return await self.create(project, body, on_created=on_created)

    async def create_batch(self, project, body):
        task = ImageGenerationTaskCreateIn(
            kind="image",
            model_id=body.model_id,
            prompt=body.prompt,
            size=body.size,
            seed=body.seed,
            reference_asset_id=body.reference_asset_id,
            reference_asset_ids=body.reference_asset_ids,
            canvas_node_id=body.canvas_node_id,
            expected_canvas_revision=body.expected_canvas_revision,
        )
        return await self.create(project, task, batch=body)

    async def create(self, project, arguments, batch=None, *, on_created=None):
        for identity in await self.store.pending(project):
            await self.deliver_reference(identity)
        try:
            selection = await self.peer.model(arguments)
            plan = await self.plan(project, arguments, selection, batch)
        except ValidationError as exc:
            raise GenerationError("生成请求参数或素材引用无效", code="invalid_reference") from exc
        await self.store.start(plan)
        try:
            payloads = await self.peer.prepare(plan)
            return await self.store.commit(plan, payloads, arguments, batch, on_created)
        except BaseException:
            # The adapter changes only a still-preparing decision. An uncertain
            # commit that already activated tasks must not be undone or retried.
            await self.store.abort(str(plan.plan_id))
            raise

    async def plan(self, project, arguments, selection, batch):
        args, titles, provenance = await self.store.resolve(
            project, arguments, selection.reference_rules
        )
        identity = uuid4()
        args = args.model_copy(update={"canvas_node_id": None, "expected_canvas_revision": None})
        identities = reference_ids(args)
        assets = await self.peer.assets(project, str(identity), identities)
        tasks = []
        for index in range(batch.grid_size if batch is not None else 1):
            request_args = args
            if batch is not None and args.seed is not None:
                request_args = args.model_copy(update={"seed": args.seed + index})
            tasks.append(
                TaskPlan(
                    task_id=uuid4(),
                    arguments=request_args,
                    explicit_fields=sorted(arguments.model_fields_set),
                    reference_titles={
                        identity: name
                        for identity, name in titles.items()
                        if identity in identities and batch is None
                    },
                    input_snapshot=provenance,
                )
            )
        return GenerationPlan(
            project_id=project,
            plan_id=identity,
            model=selection.choice,
            tasks=tasks,
            assets=assets,
        )
