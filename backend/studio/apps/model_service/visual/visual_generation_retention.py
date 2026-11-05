"""Clean unreferenced private staging and release originals after provider submission."""

import re
import shutil
from functools import partial

from anyio.to_thread import run_sync
from sqlalchemy import select, text

from studio.apps.model_service.storage.visual_generation_records import (
    VisualProviderBatch,
    VisualProviderTask,
)

REQUIRES_INPUT = ("prepared", "queued", "submitting")


def unfinished_inputs():
    return (
        select(VisualProviderTask.id)
        .where(
            VisualProviderTask.batch_id == VisualProviderBatch.id,
            VisualProviderTask.status.in_(REQUIRES_INPUT),
        )
        .exists()
    )


class ProviderRetention:
    def __init__(self, sessions, intake):
        self.sessions, self.intake = sessions, intake

    async def recover(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            inputs = set(
                await session.execute(
                    select(VisualProviderBatch.owner_user_id, VisualProviderBatch.input_key).where(
                        VisualProviderBatch.input_key.is_not(None)
                    )
                )
            )
            outputs = {
                (owner, value["key"])
                for owner, value in await session.execute(
                    select(
                        VisualProviderTask.owner_user_id, VisualProviderTask.result_metadata
                    ).where(VisualProviderTask.result_metadata.is_not(None))
                )
                if value and not value.get("delivered")
            }
        await run_sync(self.remove_orphans, inputs, outputs)
        await self.retire_inputs()

    def remove_orphans(self, inputs, outputs):
        root = self.intake.root
        if root.is_symlink() or not root.is_dir():
            return
        for account in root.iterdir():
            if account.is_symlink() or not account.is_dir():
                continue
            for name in ("inputs", "outputs"):
                folder = account / name
                if folder.is_symlink() or not folder.is_dir():
                    continue
                for item in folder.iterdir():
                    key = (account.name, item.name)
                    if item.is_symlink():
                        continue
                    if (
                        name == "inputs"
                        and item.is_dir()
                        and re.fullmatch(r"plan-[a-z0-9_]+", item.name)
                    ):
                        if key not in inputs:
                            shutil.rmtree(item, ignore_errors=True)
                    if (
                        name == "outputs"
                        and item.is_file()
                        and re.fullmatch(r"[a-f0-9]{32}(?:\.tmp)?", item.name)
                    ):
                        if key not in outputs:
                            item.unlink(missing_ok=True)

    async def retire_inputs(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            candidates = list(
                await session.execute(
                    select(VisualProviderBatch.owner_user_id, VisualProviderBatch.id)
                    .where(
                        VisualProviderBatch.state == "active",
                        VisualProviderBatch.input_key.is_not(None),
                        ~unfinished_inputs(),
                    )
                    .limit(50)
                )
            )
        for owner, identity in candidates:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                batch = await session.scalar(
                    select(VisualProviderBatch).where(
                        VisualProviderBatch.id == identity,
                        VisualProviderBatch.state == "active",
                        VisualProviderBatch.input_key.is_not(None),
                        ~unfinished_inputs(),
                    )
                )
                if batch is None:
                    continue
                path = self.intake.staging_root(owner) / batch.input_key
                batch.input_key = batch.source_assertion = batch.source_path = None
                batch.input_assets = []
                await session.commit()
            if not path.is_symlink() and path.resolve().is_relative_to(self.intake.root.resolve()):
                await run_sync(partial(shutil.rmtree, path, ignore_errors=True))
