"""Deliver committed Motion export intents and settle Rendering receipts."""

import httpx
from sqlalchemy import select, update

from app.apps.motion_compositor.models import MotionTask
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.motion_exports import PREFIX, RenderRequest, RenderStatus

from .models import MotionExportBinding

RENDERING = "http://rendering:8080"
ACTIVE = ("queued", "running")


class ExportDelivery(PollingTaskRunner):
    runner_name = "motion-export-delivery"
    poll_interval_seconds = 1.0

    def __init__(self, sessions, capabilities, peer):
        super().__init__()
        self.sessions = sessions
        self.client = capabilities.client
        self.peer = peer

    async def recover(self):
        # Committed intents are delivered the same way on startup and steady state.
        pass

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pair = (
                await session.execute(
                    select(MotionExportBinding, MotionTask)
                    .outerjoin(MotionTask, MotionTask.id == MotionExportBinding.task_id)
                    .where(
                        MotionTask.id.is_(None)
                        | MotionTask.status.in_(ACTIVE)
                        | (
                            (MotionTask.status == "cancelled")
                            & (MotionExportBinding.assertion != "")
                        )
                    )
                    .order_by(MotionExportBinding.checked_at, MotionExportBinding.task_id)
                    .limit(1)
                )
            ).one_or_none()
        if pair is not None:
            await self.deliver(*pair)

    def session(self, binding):
        return self.sessions(info={"owner_user_id": binding.owner_user_id})

    async def control(self, binding, action):
        path = f"{PREFIX}/{binding.remote_id}/control/{action}"
        return await self.client.post(
            RENDERING + path,
            headers=self.peer.headers("POST", path, binding.owner_user_id),
        )

    async def submit(self, binding):
        frozen = RenderRequest.model_validate(binding.frozen_request)
        return await self.client.post(
            RENDERING + binding.request_path,
            content=frozen.model_dump_json().encode(),
            headers={HEADER: binding.assertion},
            timeout=httpx.Timeout(240, connect=5),
        )

    async def deliver(self, binding, task):
        receipt = None
        try:
            if task is None or task.status == "cancelled":
                response = await self.control(binding, "purge")
                if response.status_code == 409:
                    return
                if response.status_code != 404:
                    response.raise_for_status()
                async with self.session(binding) as session:
                    owned = await session.get(MotionExportBinding, binding.task_id)
                    if owned is not None:
                        await session.delete(owned)
                        await session.commit()
                return
            if task.cancel_requested:
                response = await self.control(binding, "cancel")
                if response.status_code == 404:
                    receipt = RenderStatus(status="cancelled", progress=0, outputs={}, error=None)
            else:
                response = await self.control(binding, "status")
                if response.status_code == 404:
                    response = await self.submit(binding)
                    if response.status_code in {401, 403, 409, 413, 422}:
                        receipt = RenderStatus(
                            status="failed",
                            progress=0,
                            outputs={},
                            error="导出授权已失效或原件已变化",
                        )
            if receipt is None:
                response.raise_for_status()
                receipt = RenderStatus.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("特效导出执行结果暂不可用") from exc
        finally:
            async with self.session(binding) as session:
                await session.execute(
                    update(MotionExportBinding)
                    .where(MotionExportBinding.task_id == binding.task_id)
                    .values(checked_at=utc_now())
                )
                await session.commit()
        if receipt is not None:
            await self.settle(binding, receipt)

    async def settle(self, binding, receipt):
        async with self.session(binding) as session:
            result = await session.execute(
                update(MotionTask)
                .where(MotionTask.id == binding.task_id, MotionTask.status.in_(ACTIVE))
                .values(**receipt.model_dump(), updated_at=utc_now())
            )
            if result.rowcount and receipt.status not in ACTIVE:
                await session.execute(
                    update(MotionExportBinding)
                    .where(MotionExportBinding.task_id == binding.task_id)
                    .values(assertion="", frozen_request={})
                )
            await session.commit()

    async def open_output(self, binding, format_name, source_headers):
        path = f"{PREFIX}/{binding.remote_id}/download/{format_name}"
        headers = self.peer.headers("GET", path, binding.owner_user_id)
        headers["Accept-Encoding"] = "identity"
        for name in ("range", "if-range"):
            if name in source_headers:
                headers[name] = source_headers[name]
        return await self.client.send(
            self.client.build_request("GET", RENDERING + path, headers=headers),
            stream=True,
        )
