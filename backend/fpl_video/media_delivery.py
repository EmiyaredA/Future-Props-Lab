"""Bridge committed Video processing tasks to Rendering and settle their receipts."""

import httpx
from sqlalchemy import select, text, update

from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.video_processing import JOBS, MediaJobOut, valid_id

from .models import VideoMediaDispatch

RENDERING = "http://rendering:8080"
ACTIVE = ("queued", "running")


class MediaDelivery(PollingTaskRunner):
    runner_name = "video-media-delivery"
    poll_interval_seconds = 1

    def __init__(self, sessions, client, peer):
        super().__init__()
        self.sessions, self.client, self.peer = sessions, client, peer

    async def recover(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            tasks = (
                await session.scalars(
                    select(VideoEditorTask)
                    .outerjoin(VideoMediaDispatch, VideoMediaDispatch.task_id == VideoEditorTask.id)
                    .where(
                        VideoEditorTask.kind == "media",
                        VideoEditorTask.status.in_(ACTIVE),
                        VideoMediaDispatch.task_id.is_(None),
                    )
                )
            ).all()
        for task in tasks:
            asset = task.request_payload.get("assetId")
            if not valid_id(asset):
                raise ValueError("剪辑素材任务缺少有效原件")
            async with self.sessions(info={"owner_user_id": task.owner_user_id}) as session:
                session.add(
                    VideoMediaDispatch(
                        task_id=task.id,
                        owner_user_id=task.owner_user_id,
                        project_id=task.project_id,
                        asset_id=asset,
                    )
                )
                await session.commit()

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pair = (
                await session.execute(
                    select(VideoMediaDispatch, VideoEditorTask)
                    .outerjoin(VideoEditorTask, VideoEditorTask.id == VideoMediaDispatch.task_id)
                    .where(VideoEditorTask.id.is_(None) | VideoEditorTask.status.in_(ACTIVE))
                    .order_by(VideoMediaDispatch.checked_at, VideoMediaDispatch.task_id)
                    .limit(1)
                )
            ).one_or_none()
        if pair is None:
            return
        binding, task = pair
        try:
            await self.deliver(binding, task)
        finally:
            async with self.session(binding) as session:
                await session.execute(
                    update(VideoMediaDispatch)
                    .where(VideoMediaDispatch.task_id == binding.task_id)
                    .values(checked_at=utc_now())
                )
                await session.commit()

    def session(self, binding):
        return self.sessions(info={"owner_user_id": binding.owner_user_id})

    async def send(self, method, path, owner):
        return await self.client.request(
            method, RENDERING + path, headers=self.peer.headers(method, path, owner)
        )

    async def deliver(self, binding, task):
        path = f"{JOBS}/{binding.task_id}"
        try:
            if task is None:
                response = await self.send("DELETE", path, binding.owner_user_id)
                if response.status_code == 409:
                    return
                response.raise_for_status()
                async with self.session(binding) as session:
                    row = await session.get(VideoMediaDispatch, binding.task_id)
                    if row is not None:
                        await session.delete(row)
                        await session.commit()
                return
            response = await self.send("GET", path, binding.owner_user_id)
            if response.status_code == 404:
                source = f"{path}/{binding.project_id}/{binding.asset_id}"
                response = await self.send("POST", source, binding.owner_user_id)
            response.raise_for_status()
            receipt = MediaJobOut.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("剪辑处理回执尚未确认") from exc
        await self.settle(binding, receipt)

    async def settle(self, binding, receipt):
        async with self.session(binding) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            task = await session.get(VideoEditorTask, binding.task_id)
            metadata = await session.get(VideoEditorAssetMetadata, binding.asset_id)
            if (
                task is None
                or task.status not in ACTIVE
                or metadata is None
                or metadata.project_id != binding.project_id
            ):
                return
            status = {
                "queued": "queued",
                "running": "processing",
                "completed": "ready",
                "failed": "failed",
                "cancelled": "failed",
            }[receipt.status]
            if receipt.status == "queued" and task.status == "running":
                return  # A retry at Rendering keeps the public task in progress.
            now = utc_now()
            error = receipt.error or (
                "剪辑素材处理已取消" if receipt.status == "cancelled" else None
            )
            if task.status != receipt.status:
                task.status = receipt.status
                task.error = error
                task.revision += 1
                task.updated_at = now
                task.started_at = task.started_at or now
                if receipt.status not in ACTIVE:
                    task.finished_at = now
                    task.progress = 100 if receipt.status == "completed" else task.progress
            if receipt.status == "completed":
                metadata.proxy_filename = receipt.proxy
                metadata.thumbnail_filename = receipt.thumbnail
                metadata.waveform_filename = receipt.waveform
                metadata.fingerprint = receipt.fingerprint
            if (metadata.processing_status, metadata.probe, metadata.error) != (
                status,
                receipt.probe,
                error,
            ):
                metadata.processing_status = status
                metadata.probe = receipt.probe
                metadata.error = error
                metadata.revision += 1
                metadata.updated_at = now
            await session.commit()

    async def output(self, binding, variant, request_headers):
        path = f"{JOBS}/{binding.task_id}/files/{variant}"
        headers = self.peer.headers("GET", path, binding.owner_user_id)
        headers["Accept-Encoding"] = "identity"
        for key in ("range", "if-range"):
            if key in request_headers:
                headers[key] = request_headers[key]
        return await self.client.send(
            self.client.build_request("GET", RENDERING + path, headers=headers),
            stream=True,
        )
