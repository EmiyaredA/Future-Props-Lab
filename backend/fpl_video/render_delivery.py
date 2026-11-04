"""Resume one sealed render dispatch and settle its asset and task atomically."""

import httpx
from sqlalchemy import select, text, update

from app.apps.video_editor.bake_organization import insert_baked_asset_in_organization
from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.motion_preview import sha256
from fpl_runtime.video_exports import EXPORTS, VIDEO_WORK, VideoExportReceipt, VideoSegmentRequest

from .models import VideoMediaDispatch, VideoRenderDispatch
from .segment_results import settle_segments

RENDERING = "http://rendering:8080"
ACTIVE = ("queued", "running")


class RenderDelivery(PollingTaskRunner):
    runner_name = "video-render-delivery"
    poll_interval_seconds = 1

    def __init__(self, sessions, client, peer, segment_delivery=None):
        super().__init__()
        self.sessions, self.client, self.peer = sessions, client, peer
        self.segment_delivery = segment_delivery

    async def recover(self):
        # All tasks with published dispatches are polled by the same identity after restart.
        pass

    def session(self, binding):
        return self.sessions(info={"owner_user_id": binding.owner_user_id})

    async def send(self, method, path, owner, *, body=None):
        return await self.client.request(
            method,
            RENDERING + path,
            content=body,
            headers=self.peer.headers(method, path, owner),
        )

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pair = (
                await session.execute(
                    select(VideoRenderDispatch, VideoEditorTask)
                    .outerjoin(VideoEditorTask, VideoEditorTask.id == VideoRenderDispatch.task_id)
                    .where(VideoRenderDispatch.settled.is_(False))
                    .order_by(VideoRenderDispatch.checked_at, VideoRenderDispatch.task_id)
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
                    update(VideoRenderDispatch)
                    .where(VideoRenderDispatch.task_id == binding.task_id)
                    .values(checked_at=utc_now())
                )
                await session.commit()

    async def claim_submission(self, binding):
        async with self.session(binding) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            task = await session.get(VideoEditorTask, binding.task_id)
            if task is None or task.cancel_requested or task.status not in ACTIVE:
                return False
            if task.status == "queued":
                now = utc_now()
                task.status = "running"
                task.progress = 1
                task.revision += 1
                task.started_at = task.started_at or now
                task.updated_at = now
                await session.commit()
            return True

    async def deliver(self, binding, task):
        path = f"{EXPORTS}/{binding.task_id}"
        owner = binding.owner_user_id
        cancel = task is None or task.cancel_requested
        receipt = None
        try:
            if cancel:
                response = await self.send("POST", path + "/cancel", owner)
                if response.status_code == 404:
                    receipt = VideoExportReceipt(status="cancelled", progress=0)
            else:
                response = await self.send("GET", path, owner)
                if response.status_code == 404:
                    if not await self.claim_submission(binding):
                        return
                    raw = VIDEO_WORK.validate_python(binding.frozen).model_dump_json().encode()
                    response = await self.send(
                        "POST", f"{path}/{binding.project_id}/{sha256(raw)}", owner, body=raw
                    )
            if receipt is None:
                response.raise_for_status()
                receipt = VideoExportReceipt.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("剪辑成片回执尚未确认") from exc
        if receipt.handoff is not None:
            request = VIDEO_WORK.validate_python(binding.frozen)
            if (
                self.segment_delivery is None
                or not isinstance(request, VideoSegmentRequest)
                or request.target != receipt.handoff.target
            ):
                raise CapabilityUnavailable("分段交接的目标范围不符")
            await self.segment_delivery.deliver(binding, receipt)
            return
        await self.settle(binding, receipt)

    async def settle(self, binding, receipt):
        async with self.session(binding) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(VideoRenderDispatch, binding.task_id)
            task = await session.get(VideoEditorTask, binding.task_id)
            if current is None or current.settled:
                return
            if task is None:
                if receipt.status not in ACTIVE:
                    await session.delete(current)
                    await session.commit()
                return
            if receipt.status == "queued":
                return
            if task.status == "cancelled" and receipt.status in ACTIVE:
                return
            if task.status == receipt.status and task.progress == receipt.progress:
                if receipt.status not in ACTIVE:
                    current.settled, current.frozen = True, {}
                    await session.commit()
                return
            now = utc_now()
            task.status = receipt.status
            task.progress = receipt.progress
            task.error = receipt.error
            task.revision += 1
            task.updated_at = now
            task.started_at = task.started_at or now
            if receipt.status not in ACTIVE:
                task.finished_at = now
                current.settled, current.frozen = True, {}
            if receipt.segments:
                await settle_segments(session, task, receipt.segments)
            if receipt.output is not None:
                asset = receipt.output
                metadata = await session.get(VideoEditorAssetMetadata, asset.id)
                if metadata is None:
                    session.add(
                        VideoEditorAssetMetadata(
                            asset_id=asset.id,
                            project_id=binding.project_id,
                            processing_status="ready",
                            probe=receipt.probe,
                            proxy_filename=receipt.variants.get("proxy"),
                            thumbnail_filename=receipt.variants.get("thumbnail"),
                            waveform_filename=receipt.variants.get("waveform"),
                            fingerprint=receipt.fingerprint,
                        )
                    )
                elif metadata.project_id != binding.project_id:
                    raise ValueError("剪辑成片回执项目不符")
                if task.kind == "clip_merge":
                    if not receipt.variants.get("proxy") or not receipt.variants.get("thumbnail"):
                        raise ValueError("合并视频派生回执缺失")
                    session.add(
                        VideoMediaDispatch(
                            task_id=task.id,
                            owner_user_id=binding.owner_user_id,
                            project_id=binding.project_id,
                            asset_id=asset.id,
                        )
                    )
                task.output_asset_id = asset.id
                task.result_detail = {
                    **task.result_detail,
                    "probe": receipt.probe,
                    "outputFilename": asset.original_filename,
                }
                if task.kind == "asset_bake":
                    source_id = task.request_payload["assetId"]
                    source = await session.get(VideoEditorAssetMetadata, source_id)
                    if source is not None and source.project_id == task.project_id:
                        await insert_baked_asset_in_organization(
                            session,
                            project_id=task.project_id,
                            source_asset_id=source_id,
                            output_asset_id=asset.id,
                        )
                    task.result_detail = {
                        "sourceAssetId": source_id,
                        "outputFilename": asset.original_filename,
                        "probe": receipt.probe,
                        "effects": task.request_payload["effects"],
                    }
            await session.commit()
