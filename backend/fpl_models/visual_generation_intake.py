"""Prepare provider tasks without allowing execution before the Visual source decision."""

import shutil
from pathlib import Path
from tempfile import mkdtemp

from sqlalchemy import select, text

from app.llm.visual_generation_model import VisualGenerationValidationError
from app.runtime.time import utc_now

from .admission import settle
from .visual_generation_preflight import normalize, original_files, verify_selection
from .visual_generation_queue import admit
from .visual_generation_records import VisualProviderBatch, VisualProviderTask


def batch_conflict():
    return VisualGenerationValidationError(
        "模型生成批次状态或摘要不匹配", code="visual_generation_batch_conflict", status=409
    )


def receipt(batch, tasks):
    return {
        "plan_id": batch.id,
        "state": batch.state,
        "payloads": {task.id: task.request_payload for task in tasks},
    }


class VisualGenerationIntake:
    def __init__(self, state):
        self.state = state
        self.sessions = state.database.sessions
        self.root = state.database.root / ".visual-generation"

    def staging_root(self, owner):
        root = self.root / owner / "inputs"
        if root.is_symlink() or not root.resolve().is_relative_to(self.state.database.root):
            raise VisualGenerationValidationError(
                "生成素材暂存目录不可用", code="visual_generation_staging_unavailable", status=503
            )
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        return root

    async def batch(self, session, project, identity, digest):
        row = await session.get(VisualProviderBatch, identity)
        if row is not None and (row.project_id, row.plan_sha256) != (project, digest):
            raise batch_conflict()
        return row

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
            prior = await self.batch(session, plan.project_id, identity, plan.digest)
            if prior is not None:
                if prior.state == "aborted":
                    raise batch_conflict()
                return receipt(prior, await self.tasks(session, identity))
            await verify_selection(session, self.state, owner, plan)
        directory = Path(mkdtemp(prefix="plan-", dir=self.staging_root(owner)))
        committing = False
        try:
            paths = await original_files(self.state, plan, originals_token, directory)
            payloads = await normalize(self.state, plan, paths)
            active = await self.state.identity.status(
                assertion=assertion, method="POST", path=plan.path
            )
            if active is not True:
                raise VisualGenerationValidationError(
                    "生成批次授权已结束",
                    code="visual_generation_authority_ended",
                    status=401 if active is False else 503,
                )
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                prior = await self.batch(session, plan.project_id, identity, plan.digest)
                if prior is not None:
                    if prior.state == "aborted":
                        raise batch_conflict()
                    return receipt(prior, await self.tasks(session, identity))
                await verify_selection(session, self.state, owner, plan)
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
            batch = await self.batch(session, project, identity, digest)
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
                        directory = self.staging_root(owner) / batch.input_key
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

    def path_for(self, batch, asset_id):
        directory = self.staging_root(batch.owner_user_id) / batch.input_key
        path = directory / asset_id
        if (
            directory.is_symlink()
            or path.is_symlink()
            or not path.resolve().is_relative_to(self.root.resolve())
            or not path.is_file()
        ):
            raise ValueError("生成参考素材文件已不存在")
        return path
