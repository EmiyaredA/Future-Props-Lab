"""Prepare provider tasks without allowing execution before the Visual source decision."""

import shutil
from pathlib import Path
from tempfile import mkdtemp

from sqlalchemy import select, text

from studio.apps.model_service.admission.admission import settle
from studio.apps.model_service.catalog.visual_generation import VisualGenerationValidationError
from studio.apps.model_service.storage.visual_generation_batches import batch_conflict, load_batch
from studio.apps.model_service.storage.visual_generation_records import (
    VisualProviderBatch,
    VisualProviderTask,
)
from studio.apps.model_service.visual.visual_generation_preflight import (
    normalize,
    original_files,
    verify_selection,
)
from studio.apps.model_service.visual.visual_generation_queue import admit
from studio.runtime.time import utc_now


def receipt(batch, tasks):
    return {
        "plan_id": batch.id,
        "state": batch.state,
        "payloads": {task.id: task.request_payload for task in tasks},
    }


class VisualGenerationIntake:
    def __init__(self, sessions, *, files, originals_client, check_authority, temporary_upload_url):
        self.sessions, self.files = sessions, files
        self.originals_client, self.check_authority = originals_client, check_authority
        self.temporary_upload_url = temporary_upload_url

    @staticmethod
    async def tasks(session, identity):
        return list(
            await session.scalars(
                select(VisualProviderTask)
                .where(VisualProviderTask.batch_id == identity)
                .order_by(VisualProviderTask.id)
            )
        )

    async def prepare(self, plan, actor, assertion, originals_token):
        owner = actor.user_id
        identity = str(plan.plan_id)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            prior = await load_batch(session, plan.project_id, identity, plan.digest)
            if prior is not None:
                if prior.state == "aborted":
                    raise batch_conflict()
                return receipt(prior, await self.tasks(session, identity))
            await verify_selection(
                session, owner, plan, temporary_upload_url=self.temporary_upload_url
            )
        directory = Path(mkdtemp(prefix="plan-", dir=self.files.staging_root(owner)))
        committing = False
        try:
            paths = await original_files(self.originals_client, plan, originals_token, directory)
            payloads = await normalize(plan, paths, temporary_upload_url=self.temporary_upload_url)
            active = await self.check_authority(assertion=assertion, method="POST", path=plan.path)
            if active is not True:
                raise VisualGenerationValidationError(
                    "生成批次授权已结束",
                    code="visual_generation_authority_ended",
                    status=401 if active is False else 503,
                )
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                prior = await load_batch(session, plan.project_id, identity, plan.digest)
                if prior is not None:
                    if prior.state == "aborted":
                        raise batch_conflict()
                    return receipt(prior, await self.tasks(session, identity))
                await verify_selection(
                    session, owner, plan, temporary_upload_url=self.temporary_upload_url
                )
                batch = VisualProviderBatch(
                    id=identity,
                    owner_user_id=owner,
                    project_id=plan.project_id,
                    plan_sha256=plan.digest,
                    state="prepared",
                    source_path=plan.path,
                    source_assertion=assertion,
                    input_key=directory.name,
                    input_assets=[asset.model_dump() for asset in plan.assets.items],
                )
                session.add(batch)
                await session.flush()
                tasks = [
                    VisualProviderTask(
                        id=str(task.task_id),
                        owner_user_id=owner,
                        batch_id=identity,
                        provider_id=plan.model.provider_id,
                        model_id=plan.model.model_id,
                        provider_kind=plan.model.provider_kind,
                        model_slug=plan.model.model_slug,
                        generation_kind=task.arguments.kind,
                        request_payload=payloads[str(task.task_id)],
                    )
                    for task in plan.tasks
                ]
                session.add_all(tasks)
                await session.flush()
                await admit(session, owner, actor.platform_role, tasks)
                committing = True
                await session.commit()
                return receipt(batch, tasks)
        finally:
            if not committing:
                shutil.rmtree(directory, ignore_errors=True)

    async def settle(self, owner, project, identity, digest, decision):
        directory = None
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await load_batch(session, project, identity, digest)
            if batch is None:
                if decision != "abort":
                    raise batch_conflict()
                batch = VisualProviderBatch(
                    id=identity,
                    owner_user_id=owner,
                    project_id=project,
                    plan_sha256=digest,
                    state="aborted",
                    input_assets=[],
                )
                session.add(batch)
            elif batch.state == "prepared":
                tasks = await self.tasks(session, identity)
                if decision == "activate":
                    batch.state = "active"
                    for task in tasks:
                        task.status = "queued"
                else:
                    batch.state = "aborted"
                    if batch.input_key:
                        directory = self.files.staging_root(owner) / batch.input_key
                    batch.source_assertion = batch.source_path = batch.input_key = None
                    batch.input_assets = []
                    for task in tasks:
                        task.status = "cancelled"
                        task.revision += 1
                        task.updated_at = utc_now()
            elif (batch.state, decision) not in {("active", "activate"), ("aborted", "abort")}:
                raise batch_conflict()
            if decision == "abort":
                await settle(session)
            await session.commit()
        if directory is not None:
            shutil.rmtree(directory, ignore_errors=True)
        return {"state": batch.state}
